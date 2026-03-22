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

// ── Wizard ──

const AUDIENCES = [
  { key: "executives", title: "Executives", desc: "C-suite, business outcomes" },
  { key: "board", title: "Board", desc: "Governance, strategy, risk" },
  { key: "investors", title: "Investors", desc: "Traction, TAM, unit economics" },
  { key: "cofounder", title: "Co-founder", desc: "Decisions, blockers, honest" },
  { key: "technical", title: "Technical", desc: "Architecture, trade-offs" },
  { key: "engineering_team", title: "Engineering", desc: "Peers, skip the pitch" },
  { key: "sales", title: "Sales Team", desc: "ROI, proof points, ammo" },
  { key: "customers", title: "Customers", desc: "Their pain, your solution" },
  { key: "partners", title: "Partners", desc: "Mutual value, integration" },
  { key: "non_technical", title: "Non-Technical", desc: "Smart, not engineers" },
  { key: "new_hires", title: "New Hires", desc: "Zero context onboarding" },
  { key: "regulators", title: "Regulators", desc: "Compliance, controls" },
  { key: "skeptics", title: "Skeptics", desc: "Prove it. Show data." },
  { key: "journalists", title: "Journalists", desc: "Newsworthy angle" },
  { key: "grandparents", title: "Grandparents", desc: "Warm, simple" },
  { key: "five_year_old", title: "Five Year Old", desc: "Lemonade stand" },
  { key: "general", title: "General", desc: "Mixed audience" },
];

const VIBES = [
  { key: "bold_corporate", title: "Bold Corporate", desc: "Dark gradients, gold" },
  { key: "ted_talk", title: "TED Talk", desc: "Big idea, bold type" },
  { key: "minimal_clean", title: "Minimal Clean", desc: "Whitespace, muted" },
  { key: "creative_agency", title: "Creative Agency", desc: "Vibrant gradients" },
  { key: "storytelling", title: "Storytelling", desc: "Cinematic, emotional" },
  { key: "data_heavy", title: "Data Heavy", desc: "Charts, infographic" },
  { key: "infographic", title: "Infographic", desc: "Flat design, icons" },
  { key: "whiteboard", title: "Whiteboard", desc: "Hand-drawn sketches" },
  { key: "chalkboard", title: "Chalkboard", desc: "Chalk on dark board" },
  { key: "sketch_pencil", title: "Pencil Sketch", desc: "Hand-drawn, notebook" },
  { key: "comic_panels", title: "Comic Panels", desc: "Bold outlines, bubbles" },
  { key: "cartoon", title: "Cartoon", desc: "Bright, playful" },
  { key: "newspaper", title: "Newspaper", desc: "Vintage broadsheet" },
  { key: "magazine_editorial", title: "Magazine", desc: "Editorial spreads" },
  { key: "blueprint", title: "Blueprint", desc: "Technical, navy+cyan" },
  { key: "neon_cyberpunk", title: "Neon Cyberpunk", desc: "Glowing neon, purple" },
  { key: "retro_80s", title: "Retro 80s", desc: "Synthwave, chrome" },
  { key: "art_deco", title: "Art Deco", desc: "1920s gold, Gatsby" },
  { key: "watercolor", title: "Watercolor", desc: "Painted washes" },
  { key: "space_cosmic", title: "Space Cosmic", desc: "Nebulas, star fields" },
  { key: "polaroid", title: "Polaroid", desc: "Scrapbook, photos" },
  { key: "pixel_art", title: "Pixel Art", desc: "8-bit retro gaming" },
  { key: "nature_organic", title: "Nature", desc: "Forest, earth tones" },
  { key: "luxury_gold", title: "Luxury Gold", desc: "Black + gold leaf" },
  { key: "grunge_punk", title: "Punk Zine", desc: "Torn paper, DIY" },
  { key: "anime_cel", title: "Anime", desc: "Cel-shaded, manga" },
  { key: "terminal_hacker", title: "Terminal", desc: "Green text, CRT" },
  { key: "isometric", title: "Isometric", desc: "Miniature 3D worlds" },
  { key: "riso_print", title: "Risograph", desc: "Grain, spot colors" },
  { key: "botanical", title: "Botanical", desc: "Lush leaves, naturalist" },
  { key: "retro_70s", title: "Retro 70s", desc: "Sunburst, warm" },
  { key: "dark_topo", title: "Topographic", desc: "Contour lines, terrain" },
  { key: "paper_craft", title: "Paper Craft", desc: "Cut paper, origami" },
  { key: "vintage_90s", title: "Vintage 90s", desc: "Memphis, MTV" },
  { key: "kittens", title: "Kittens", desc: "Business cats, cute" },
  { key: "bloomberg_keynote", title: "Bloomberg", desc: "Teal-slate, WWDC" },
];

let wizTopic = "";
let wizAudience = "";
let wizVibe = "";
let wizSlideCount = 8;
let wizVibeSamples: Record<string, string> = {};

function renderWizard(topic: string, vibeSamples: Record<string, string>) {
  wizTopic = topic;
  wizVibeSamples = vibeSamples;
  const wiz = $("wizard");
  wiz.style.display = "";
  wiz.textContent = "";

  // Topic display
  const topicEl = document.createElement("div");
  topicEl.className = "wiz-topic";
  topicEl.textContent = topic.length > 200 ? topic.substring(0, 200) + "..." : topic;
  wiz.appendChild(topicEl);

  // Audience
  const audSection = document.createElement("div");
  audSection.className = "wiz-section";
  const audLabel = document.createElement("div");
  audLabel.className = "wiz-label";
  audLabel.textContent = "Who is your audience?";
  audSection.appendChild(audLabel);
  const audGrid = document.createElement("div");
  audGrid.className = "wiz-grid";
  audGrid.id = "aud-grid";
  AUDIENCES.forEach((a) => {
    const opt = document.createElement("div");
    opt.className = "wiz-opt" + (wizAudience === a.key ? " selected" : "");
    opt.dataset.key = a.key;
    const t = document.createElement("div");
    t.className = "wiz-opt-title";
    t.textContent = a.title;
    const d = document.createElement("div");
    d.className = "wiz-opt-desc";
    d.textContent = a.desc;
    opt.appendChild(t);
    opt.appendChild(d);
    opt.addEventListener("click", () => {
      wizAudience = a.key;
      audGrid.querySelectorAll(".wiz-opt").forEach((o) => o.classList.remove("selected"));
      opt.classList.add("selected");
    });
    audGrid.appendChild(opt);
  });
  audSection.appendChild(audGrid);
  wiz.appendChild(audSection);

  // Vibe
  const vibeSection = document.createElement("div");
  vibeSection.className = "wiz-section";
  const vibeLabel = document.createElement("div");
  vibeLabel.className = "wiz-label";
  vibeLabel.textContent = "Visual style";
  vibeSection.appendChild(vibeLabel);
  const vibeGrid = document.createElement("div");
  vibeGrid.className = "wiz-grid vibe-grid";
  vibeGrid.id = "vibe-grid";
  VIBES.forEach((v) => {
    const opt = document.createElement("div");
    opt.className = "wiz-opt vibe-card" + (wizVibe === v.key ? " selected" : "");
    opt.dataset.key = v.key;
    if (vibeSamples[v.key]) {
      opt.style.backgroundImage = `url(${vibeSamples[v.key]})`;
    }
    const label = document.createElement("div");
    label.className = "vibe-label";
    const t = document.createElement("div");
    t.className = "wiz-opt-title";
    t.textContent = v.title;
    const d = document.createElement("div");
    d.className = "wiz-opt-desc";
    d.textContent = v.desc;
    label.appendChild(t);
    label.appendChild(d);
    opt.appendChild(label);
    opt.addEventListener("click", () => {
      wizVibe = v.key;
      vibeGrid.querySelectorAll(".wiz-opt").forEach((o) => o.classList.remove("selected"));
      opt.classList.add("selected");
    });
    vibeGrid.appendChild(opt);
  });
  vibeSection.appendChild(vibeGrid);
  wiz.appendChild(vibeSection);

  // Slide count
  const countSection = document.createElement("div");
  countSection.className = "wiz-section";
  const countLabel = document.createElement("div");
  countLabel.className = "wiz-label";
  countLabel.textContent = "How many slides?";
  countSection.appendChild(countLabel);
  const countRow = document.createElement("div");
  countRow.className = "slide-count-row";
  countRow.id = "count-row";
  [5, 8, 10, 12, 15].forEach((n) => {
    const opt = document.createElement("div");
    opt.className = "wiz-opt" + (wizSlideCount === n ? " selected" : "");
    opt.dataset.key = String(n);
    const t = document.createElement("div");
    t.className = "wiz-opt-title";
    t.textContent = String(n);
    const d = document.createElement("div");
    d.className = "wiz-opt-desc";
    d.textContent = n <= 5 ? "Quick pitch" : n <= 8 ? "Standard" : n <= 10 ? "Full talk" : n <= 12 ? "Detailed" : "Deep dive";
    opt.appendChild(t);
    opt.appendChild(d);
    opt.addEventListener("click", () => {
      wizSlideCount = n;
      countRow.querySelectorAll(".wiz-opt").forEach((o) => o.classList.remove("selected"));
      opt.classList.add("selected");
    });
    countRow.appendChild(opt);
  });
  countSection.appendChild(countRow);
  wiz.appendChild(countSection);

  // Submit button
  const submitBtn = document.createElement("button");
  submitBtn.className = "wiz-submit";
  submitBtn.id = "wiz-submit";
  submitBtn.textContent = "Create Deck";
  submitBtn.addEventListener("click", submitWizard);
  wiz.appendChild(submitBtn);

  // Pre-select defaults
  wizAudience = "";
  wizVibe = "";
  wizSlideCount = 8;
  countRow.querySelector('[data-key="8"]')?.classList.add("selected");
}

async function submitWizard() {
  if (!wizAudience) { setStatus("Please select an audience", true); return; }
  if (!wizVibe) { setStatus("Please select a visual style", true); return; }

  const btn = $("wiz-submit") as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = "Creating deck...";
  $("wizard").style.display = "none";
  setStatus(`Creating deck \u2014 ${wizSlideCount} slides, ${wizVibe} style, for ${wizAudience}...`);
  setBadge("creating");

  try {
    const result = await app.callServerTool({
      name: "submit-deck",
      arguments: { topic: wizTopic, audience: wizAudience, vibe: wizVibe, slideCount: wizSlideCount },
    });
    const data = (result as any).structuredContent;
    if (data?.error) {
      setStatus("Error: " + data.error, true);
      return;
    }
    projectId = data.projectId;
    const link = $("web-link") as HTMLAnchorElement;
    link.href = data.webUrl;
    link.style.display = "";
    link.textContent = "Open in SlideCraft";
    startPolling();
  } catch (err) {
    setStatus("Error: " + String(err), true);
    btn.disabled = false;
    btn.textContent = "Create Deck";
    $("wizard").style.display = "";
  }
}

// ── Event handlers (register BEFORE connect) ──

app.ontoolresult = (result: any) => {
  const data = result.structuredContent;
  if (!data) { setStatus("No data received"); return; }

  currentAction = data.action || "";

  if (currentAction === "wizard") {
    setBadge("wizard");
    setStatus("Choose your audience, visual style, and slide count:");
    renderWizard(data.topic, data.vibeSamples || {});
  } else if (currentAction === "create-deck") {
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
