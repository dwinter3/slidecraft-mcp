#!/usr/bin/env node
/**
 * SlideCraft MCP App Server
 *
 * Exposes tools for creating and viewing slide decks via Claude Desktop.
 * Uses Streamable HTTP transport for remote access, stdio for local dev.
 */
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import cors from "cors";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

// ── Config ──

const SLIDECRAFT_API =
  process.env.SLIDECRAFT_API_URL ||
  "https://slidecraft.alpha-pm.dev";

const SLIDECRAFT_API_KEY = process.env.SLIDECRAFT_API_KEY || "";

const DIST_DIR = import.meta.filename?.endsWith(".ts")
  ? path.join(import.meta.dirname!, "dist")
  : import.meta.dirname!;

// ── API helpers ──

async function apiCall(
  method: string,
  endpoint: string,
  body?: unknown,
): Promise<unknown> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (SLIDECRAFT_API_KEY) headers["Authorization"] = `Bearer ${SLIDECRAFT_API_KEY}`;

  const res = await fetch(`${SLIDECRAFT_API}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// ── Server factory ──

export function createServer(apiKey?: string): McpServer {
  const server = new McpServer({
    name: "SlideCraft",
    version: "1.0.0",
  });

  const resourceUri = "ui://slidecraft/mcp-app.html";

  // ── Tool: create-deck ──
  registerAppTool(
    server,
    "create-deck",
    {
      title: "Create Slide Deck",
      description:
        "Create an AI-powered slide deck. Provide a topic/description, audience, visual style, and slide count. Returns an interactive deck builder.",
      inputSchema: {
        topic: z
          .string()
          .describe("What the deck is about — topic, objective, or paste content"),
        audience: z
          .enum([
            "executives",
            "board",
            "investors",
            "cofounder",
            "technical",
            "engineering_team",
            "sales",
            "customers",
            "partners",
            "non_technical",
            "general",
          ])
          .default("general")
          .describe("Target audience"),
        vibe: z
          .enum([
            "bold_corporate",
            "ted_talk",
            "minimal_clean",
            "creative_agency",
            "storytelling",
            "data_heavy",
            "infographic",
            "whiteboard",
            "chalkboard",
            "blueprint",
            "neon_cyberpunk",
            "retro_80s",
            "art_deco",
            "watercolor",
            "space_cosmic",
            "pixel_art",
            "nature_organic",
            "terminal_hacker",
            "isometric",
            "kittens",
            "bloomberg_keynote",
          ])
          .default("bold_corporate")
          .describe("Visual style"),
        slideCount: z
          .number()
          .min(3)
          .max(20)
          .default(8)
          .describe("Number of slides (3-20)"),
      },
      _meta: { ui: { resourceUri } },
    },
    async ({ topic, audience, vibe, slideCount }) => {
      // 1. Create project
      const project = (await apiCall("POST", "/api/create-project", {
        title: topic.substring(0, 80),
        objective: topic,
        audience,
        vibe,
        style: "persuasive",
        slide_count: slideCount,
      })) as { ok: boolean; project_id: string };

      if (!project.ok) {
        return {
          content: [{ type: "text", text: "Failed to create project" }],
        };
      }

      // 2. Ingest topic as source
      await apiCall("POST", "/api/ingest-source", {
        project_id: project.project_id,
        type: "text",
        content: topic,
        label: "Deck description",
      });

      // 3. Start planning
      const plan = (await apiCall("POST", "/api/plan-deck", {
        project_id: project.project_id,
        audience,
        vibe,
        slide_count: slideCount,
      })) as { ok: boolean; plan_id: string };

      const result = {
        action: "create-deck",
        projectId: project.project_id,
        planId: plan.plan_id,
        topic,
        audience,
        vibe,
        slideCount,
        apiUrl: SLIDECRAFT_API,
        webUrl: `https://slidecraft.alpha-pm.dev/?project=${project.project_id}&tab=overview`,
      };

      return {
        content: [
          {
            type: "text",
            text: `Creating "${topic}" — ${slideCount} slides, ${vibe} style, for ${audience}.\n\nProject: ${project.project_id}\nView: ${result.webUrl}`,
          },
        ],
        structuredContent: result,
      };
    },
  );

  // ── Tool: list-decks ──
  registerAppTool(
    server,
    "list-decks",
    {
      title: "List Decks",
      description: "Show all your SlideCraft decks",
      inputSchema: {},
      _meta: { ui: { resourceUri } },
    },
    async () => {
      const data = (await apiCall("GET", "/api/projects")) as {
        projects: Array<{
          project_id: string;
          title: string;
          status: string;
          created_at: string;
          vibe: string;
        }>;
      };
      return {
        content: [
          {
            type: "text",
            text: `You have ${data.projects.length} decks:\n${data.projects.map((p) => `- ${p.title} (${p.status})`).join("\n")}`,
          },
        ],
        structuredContent: { action: "list-decks", projects: data.projects, apiUrl: SLIDECRAFT_API },
      };
    },
  );

  // ── Tool: check-build (app-only, called from UI to poll progress) ──
  registerAppTool(
    server,
    "check-build",
    {
      title: "Check Build Progress",
      description: "Poll build status for a project",
      inputSchema: {
        projectId: z.string(),
      },
      _meta: { ui: { resourceUri, visibility: ["app"] } },
    },
    async ({ projectId }) => {
      const [planStatus, jobs, slides] = await Promise.all([
        apiCall("GET", `/api/plan-status?project_id=${encodeURIComponent(projectId)}`),
        apiCall("GET", `/api/fix-jobs?project=${encodeURIComponent(projectId)}`),
        apiCall("GET", `/api/slides?project=${encodeURIComponent(projectId)}`),
      ]);
      return {
        content: [{ type: "text", text: "Build status" }],
        structuredContent: { planStatus, jobs, slides },
      };
    },
  );

  // ── Tool: generate-slides (app-only, called after plan completes) ──
  registerAppTool(
    server,
    "generate-slides",
    {
      title: "Generate Slides",
      description: "Submit slide generation jobs for a planned project",
      inputSchema: {
        projectId: z.string(),
        plan: z.array(z.object({
          number: z.string(),
          title: z.string().optional(),
          prompt_hint: z.string().optional(),
          key_points: z.array(z.string()).optional(),
          source_text: z.string().optional(),
        })),
        vibeRules: z.string().default(""),
      },
      _meta: { ui: { resourceUri, visibility: ["app"] } },
    },
    async ({ projectId, plan, vibeRules }) => {
      const results: Array<{ slideNumber: string; jobId?: string; ok: boolean }> = [];
      for (const slide of plan) {
        let prompt = slide.prompt_hint || slide.title || "";
        if (slide.key_points?.length) prompt += "\n\nKey points: " + slide.key_points.join(", ");
        if (slide.source_text) prompt += "\n\nSource content: " + slide.source_text;

        const data = (await apiCall("POST", "/api/new-slide", {
          project_id: projectId,
          slide_number: slide.number,
          custom_prompt: prompt,
          traits: [],
          vibe_rules: vibeRules,
        })) as { ok: boolean; job_id?: string };

        results.push({ slideNumber: slide.number, jobId: data.job_id, ok: data.ok });
      }
      return {
        content: [{ type: "text", text: `Submitted ${results.length} slides for generation` }],
        structuredContent: { results },
      };
    },
  );

  // ── UI Resource ──
  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => {
      const html = await fs.readFile(
        path.join(DIST_DIR, "mcp-app.html"),
        "utf-8",
      );
      return {
        contents: [
          {
            uri: resourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            _meta: {
              ui: {
                csp: {
                  resourceDomains: [
                    "https://*.s3.amazonaws.com",
                    "https://*.s3.us-east-1.amazonaws.com",
                    "https://slide-agent-imgs-571015476446.s3.us-east-1.amazonaws.com",
                  ],
                  connectDomains: [
                    SLIDECRAFT_API,
                  ],
                },
              },
            },
          },
        ],
      };
    },
  );

  return server;
}

// ── Entrypoint ──

async function main() {
  // Health check: verify build, API key, and API connectivity
  if (process.argv.includes("--health")) {
    console.log("SlideCraft MCP Server v1.0.0");
    console.log(`  API URL: ${SLIDECRAFT_API}`);
    console.log(`  API Key: ${SLIDECRAFT_API_KEY ? SLIDECRAFT_API_KEY.substring(0, 12) + "..." : "(not set)"}`);
    try {
      const res = await fetch(`${SLIDECRAFT_API}/api/projects`, {
        headers: SLIDECRAFT_API_KEY ? { Authorization: `Bearer ${SLIDECRAFT_API_KEY}` } : {},
      });
      const data = (await res.json()) as { projects?: unknown[] };
      if (res.ok && data.projects) {
        console.log(`  API Status: OK (${data.projects.length} projects)`);
        console.log("\nHealth check passed. Ready to use.");
        process.exit(0);
      } else {
        console.log(`  API Status: ERROR (HTTP ${res.status})`);
        process.exit(1);
      }
    } catch (err) {
      console.log(`  API Status: UNREACHABLE (${err})`);
      process.exit(1);
    }
  }

  if (process.argv.includes("--stdio")) {
    const server = createServer();
    await server.connect(new StdioServerTransport());
    console.error("[slidecraft-mcp] Running on stdio");
  } else {
    const port = parseInt(process.env.PORT ?? "3001", 10);
    const app = express();
    app.use(cors());
    app.use(express.json());

    app.all("/mcp", async (req, res) => {
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless
      });
      res.on("close", () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    });

    // Health check
    app.get("/health", (_req, res) => {
      res.json({ ok: true, name: "SlideCraft MCP App", version: "1.0.0" });
    });

    app.listen(port, () => {
      console.error(`[slidecraft-mcp] Streamable HTTP server on port ${port}`);
      console.error(`[slidecraft-mcp] MCP endpoint: http://localhost:${port}/mcp`);
    });
  }
}

main().catch(console.error);
