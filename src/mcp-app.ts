/**
 * SlideCraft MCP App — Client-side UI
 *
 * Renders inside Claude Desktop as a sandboxed iframe.
 * Communicates with the SlideCraft MCP server via app.callServerTool().
 */
import { App } from "@modelcontextprotocol/ext-apps";

const app = new App({ name: "SlideCraft", version: "1.0.0" });

// ── State ──
let currentAction = "";
let projectId = "";
let planId = "";
let apiUrl = "";
let startTime = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let elapsedTimer: ReturnType<typeof setInterval> | null = null;
let slideNumbers: string[] = [];
let lastLogCount = 0;

// ── DOM helpers ──
const $ = (id: string) => document.getElementById(id)!;

function setStatus(msg: string, isError = false) {
  const el = $("status");
  el.textContent = msg;
  el.className = "status-msg" + (isError ? " error" : "");
}

function setBadge(text: string) {
  $("mode-badge").textContent = text;
}

function showProgress(done: number, total: number, active: number, failed: number) {
  $("progress-section").style.display = "";
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  ($("progress-fill") as HTMLElement).style.width = pct + "%";
  let label = `${done} / ${total} slides`;
  if (active > 0) label += ` — ${active} generating`;
  if (failed > 0) label += ` (${failed} failed)`;
  $("progress-label").textContent = label;
}

function startElapsed() {
  startTime = Date.now();
  elapsedTimer = setInterval(() => {
    const sec = Math.floor((Date.now() - startTime) / 1000);
    const min = Math.floor(sec / 60);
    $("progress-elapsed").textContent = `${min}:${(sec % 60).toString().padStart(2, "0")}`;
  }, 1000);
}

function stopElapsed() {
  if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
}

// ── Slide Grid ──

function renderSlideGrid(slides: string[]) {
  const grid = $("slide-grid");
  grid.textContent = "";
  slides.forEach((num) => {
    const card = document.createElement("div");
    card.className = "slide-card";
    card.id = `sc-${num}`;
    const ph = document.createElement("div");
    ph.className = "placeholder";
    ph.textContent = num;
    card.appendChild(ph);
    const footer = document.createElement("div");
    footer.className = "card-footer";
    footer.textContent = "Waiting";
    card.appendChild(footer);
    grid.appendChild(card);
  });
}

function updateSlideCard(num: string, status: string, imageUrl?: string, qaScore?: number) {
  const card = document.getElementById(`sc-${num}`);
  if (!card) return;
  card.className = `slide-card ${status}`;
  card.textContent = "";

  if (status === "done" && imageUrl) {
    const img = document.createElement("img");
    img.src = imageUrl;
    img.loading = "lazy";
    card.appendChild(img);
  } else if (status === "generating") {
    const wrap = document.createElement("div");
    wrap.className = "spinner-wrap";
    const sp = document.createElement("div");
    sp.className = "spinner";
    wrap.appendChild(sp);
    card.appendChild(wrap);
  } else {
    const ph = document.createElement("div");
    ph.className = "placeholder";
    ph.textContent = num;
    card.appendChild(ph);
  }

  const footer = document.createElement("div");
  footer.className = "card-footer";
  const icon = status === "done" ? "\u2713" : status === "failed" ? "\u2717" : status === "generating" ? "\u25CB" : "";
  const qaText = qaScore ? ` \u2014 QA: ${qaScore}/10` : "";
  footer.textContent = `${icon} ${status}${qaText}`;
  card.appendChild(footer);
}

// ── Log ──

function appendLog(entries: Array<{ ts: string; msg: string; level?: string }>) {
  const logEl = $("log-entries");
  const logWrap = $("build-log");
  if (!entries.length) return;
  logWrap.style.display = "";
  entries.forEach((e) => {
    const div = document.createElement("div");
    div.className = `log-entry ${e.level || ""}`;
    div.textContent = (e.ts ? e.ts + " " : "") + e.msg;
    logEl.appendChild(div);
  });
  logEl.scrollTop = logEl.scrollHeight;
}

// ── Project List ──

function renderProjectList(
  projects: Array<{ project_id: string; title: string; status: string; created_at: string }>,
) {
  const list = $("project-list");
  list.style.display = "";
  list.textContent = "";
  if (!projects.length) {
    const empty = document.createElement("div");
    empty.style.cssText = "color:#555;padding:20px;text-align:center;";
    empty.textContent = "No decks yet";
    list.appendChild(empty);
    return;
  }
  projects.forEach((p) => {
    const item = document.createElement("div");
    item.className = "project-item";
    const title = document.createElement("span");
    title.className = "p-title";
    title.textContent = p.title || p.project_id;
    const statusEl = document.createElement("span");
    statusEl.className = "p-status";
    statusEl.textContent = p.status;
    const dateEl = document.createElement("span");
    dateEl.className = "p-date";
    dateEl.textContent = p.created_at ? new Date(p.created_at).toLocaleDateString() : "";
    item.appendChild(title);
    item.appendChild(statusEl);
    item.appendChild(dateEl);
    list.appendChild(item);
  });
}

// ── Build polling ──

async function pollBuild() {
  if (!projectId) return;
  try {
    const result = await app.callServerTool({
      name: "check-build",
      arguments: { projectId },
    });
    const data = (result as any).structuredContent;
    if (!data) return;

    const { planStatus, jobs, slides } = data;

    // Phase 1: still planning
    if (planStatus?.status === "planning") {
      setStatus("AI is planning your deck...");
      return;
    }

    // Phase 1->2: plan done, need to submit generation
    if (planStatus?.status === "done" && planStatus.plan?.length && Object.keys(jobs || {}).length === 0) {
      setStatus("Plan ready \u2014 submitting slides for generation...");
      slideNumbers = planStatus.plan.map((s: any) => s.number);
      renderSlideGrid(slideNumbers);
      startElapsed();

      await app.callServerTool({
        name: "generate-slides",
        arguments: {
          projectId,
          plan: planStatus.plan,
          vibeRules: planStatus.vibe_rules || "",
        },
      });
      setStatus("Generating slides...");
      return;
    }

    // Phase 2: generation in progress
    if (jobs && Object.keys(jobs).length > 0) {
      const jobList = Object.values(jobs) as any[];
      if (!slideNumbers.length) {
        const nums = new Set<string>();
        jobList.forEach((j: any) => {
          const n = j.slide_number || j.slide || "";
          if (n) nums.add(n);
        });
        slideNumbers = Array.from(nums).sort((a, b) => {
          const na = parseInt(a), nb = parseInt(b);
          if (!isNaN(na) && !isNaN(nb)) return na - nb;
          return a.localeCompare(b);
        });
        renderSlideGrid(slideNumbers);
        if (!startTime) startElapsed();
      }

      const bySlide: Record<string, any> = {};
      jobList.forEach((j: any) => {
        const n = j.slide_number || j.slide || "";
        if (!n) return;
        if (!bySlide[n] || (j.created_at || "") > (bySlide[n].created_at || "")) bySlide[n] = j;
      });

      let done = 0, failed = 0, active = 0;
      slideNumbers.forEach((num) => {
        const j = bySlide[num];
        if (!j) return;
        if (j.status === "done") { done++; updateSlideCard(num, "done", j.result?.url, j.result?.qa?.score); }
        else if (j.status === "failed") { failed++; updateSlideCard(num, "failed"); }
        else { active++; updateSlideCard(num, j.status || "queued"); }
      });

      // Log
      const logBatch: Array<{ ts: string; msg: string; level?: string }> = [];
      jobList.forEach((j: any) => {
        const label = `Slide ${j.slide_number || j.slide || "?"}`;
        (j.log || []).forEach((e: any) => {
          const level = e.msg?.includes("QA:") ? "qa" : e.msg?.includes("Preflight:") ? "preflight" : "";
          logBatch.push({ ts: e.ts || "", msg: `${label}: ${e.msg}`, level });
        });
      });
      logBatch.sort((a, b) => a.ts.localeCompare(b.ts));
      if (logBatch.length > lastLogCount) {
        appendLog(logBatch.slice(lastLogCount));
        lastLogCount = logBatch.length;
      }

      showProgress(done, slideNumbers.length, active, failed);

      if (active === 0 && (done > 0 || failed > 0)) {
        stopElapsed();
        setStatus(`Done! ${done}/${slideNumbers.length} slides generated${failed ? ` (${failed} failed)` : ""}.`);
        stopPolling();
        const link = $("web-link") as HTMLAnchorElement;
        link.href = `https://slidecraft.alpha-pm.dev/?project=${projectId}&tab=overview`;
        link.style.display = "";
      } else {
        setStatus(`Generating slides... ${done}/${slideNumbers.length} complete`);
      }
    }
  } catch (err) {
    console.error("[poll]", err);
  }
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(pollBuild, 3000);
  pollBuild();
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// ── Event handlers (register BEFORE connect) ──

app.ontoolresult = (result: any) => {
  const data = result.structuredContent;
  if (!data) { setStatus("No data received"); return; }

  currentAction = data.action || "";

  if (currentAction === "create-deck") {
    setBadge("creating");
    projectId = data.projectId;
    planId = data.planId;
    apiUrl = data.apiUrl;
    setStatus(`Creating "${data.topic}" \u2014 ${data.slideCount} slides, ${data.vibe} style`);
    const link = $("web-link") as HTMLAnchorElement;
    link.href = data.webUrl;
    link.style.display = "";
    startPolling();
  } else if (currentAction === "list-decks") {
    setBadge("decks");
    setStatus(`${data.projects.length} decks`);
    renderProjectList(data.projects);
  }
};

app.ontoolinput = () => {};
app.ontoolcancelled = () => { setStatus("Cancelled"); stopPolling(); stopElapsed(); };
app.onerror = (err: any) => { setStatus("Error: " + (err?.message || String(err)), true); };
app.onhostcontextchanged = (ctx: any) => {
  if (ctx?.theme === "light") {
    document.body.style.background = "#f5f5f5";
    document.body.style.color = "#333";
  }
};

// ── Connect ──
setBadge("connecting");
app.connect();
setBadge("ready");
setStatus("Ready");
