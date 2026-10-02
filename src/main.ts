import "./styles.css";
import { GAME_SERVICES, checkHealth, launchUrl, type GameService } from "./registry";
import {
  createAccount,
  deleteAccount,
  ensureGameSeed,
  ensureProgress,
  listAccounts,
  listSessions,
  listProgressForAccount,
  recordGameResult,
  getProgress,
  type Account,
} from "./db";

const ACTIVE_KEY = "gm.activeAccountId";

const el = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

let accounts: Account[] = [];
let activeId: string | null = localStorage.getItem(ACTIVE_KEY);
let currentService: GameService | null = null;
let currentLaunchUrl = "";

function toast(msg: string): void {
  const t = el("toast");
  t.textContent = msg;
  t.style.display = "block";
  setTimeout(() => (t.style.display = "none"), 2600);
}

function activeAccount(): Account | null {
  return accounts.find((a) => a.id === activeId) ?? null;
}

// ---------- accounts ----------

async function refreshAccounts(): Promise<void> {
  accounts = await listAccounts();
  if (activeId && !accounts.some((a) => a.id === activeId)) {
    activeId = null;
    localStorage.removeItem(ACTIVE_KEY);
  }
  const box = el("accounts");
  box.innerHTML = "";
  if (accounts.length === 0) {
    box.innerHTML = `<p class="hint">No accounts yet — create one to start tracking Space Shooter progress.</p>`;
  }
  for (const a of accounts) {
    const div = document.createElement("div");
    div.className = "account" + (a.id === activeId ? " active" : "");
    const name = document.createElement("div");
    name.className = "name";
    name.innerHTML = "";
    const b = document.createElement("b");
    b.textContent = a.username;
    const sm = document.createElement("small");
    sm.textContent = `created ${new Date(a.createdAt).toLocaleString()}`;
    name.append(b, sm);
    const use = document.createElement("button");
    use.className = "ghost";
    use.textContent = a.id === activeId ? "Active" : "Use";
    use.disabled = a.id === activeId;
    use.onclick = async () => {
      activeId = a.id;
      localStorage.setItem(ACTIVE_KEY, a.id);
      await ensureProgress(a.id, "space-shooter");
      await refreshAll();
    };
    const del = document.createElement("button");
    del.className = "danger";
    del.textContent = "✕";
    del.title = `Delete ${a.username}`;
    del.onclick = async () => {
      if (!confirm(`Delete account "${a.username}" and its progress?`)) return;
      await deleteAccount(a.id);
      await refreshAll();
      toast(`Account "${a.username}" deleted.`);
    };
    div.append(name, use, del);
    box.append(div);
  }
  // If the game iframe is open, reload it so it carries the new account.
  if (currentService && currentLaunchUrl) {
    openInFrame(currentService);
  }
}

// ---------- services ----------

async function refreshServices(): Promise<void> {
  const box = el("services");
  box.innerHTML = "";
  const account = activeAccount();
  for (const s of GAME_SERVICES) {
    const card = document.createElement("div");
    card.className = "game-card";
    const dot = document.createElement("span");
    dot.className = "dot";
    const head = document.createElement("h3");
    head.append(dot, document.createTextNode(` ${s.name}  `));
    const port = document.createElement("small");
    port.style.color = "#9a9ac0";
    port.textContent = `:${s.port}`;
    head.append(port);
    const desc = document.createElement("p");
    desc.textContent = `${s.description} Controls: ${s.controls}.`;
    const row = document.createElement("div");
    row.className = "row";
    const play = document.createElement("button");
    play.textContent = account ? `▶ Play as ${account.username}` : "▶ Play (no account)";
    play.onclick = () => openInFrame(s);
    const tab = document.createElement("button");
    tab.className = "ghost";
    tab.textContent = "Open service ↗";
    tab.onclick = () => window.open(launchUrl(s, account), "_blank", "noopener");
    const status = document.createElement("span");
    status.className = "hint";
    status.textContent = "probing…";
    row.append(play, tab);
    card.append(head, desc, row, status);
    box.append(card);
    checkHealth(s).then((ok) => {
      dot.classList.add(ok ? "on" : "off");
      status.textContent = ok
        ? `● online at ${s.devUrl}`
        : `○ offline — run "npm run dev" in Manager to start it (or "npm run dev" in "${s.name}").`;
    });
  }
}

// ---------- stage (iframe embed) ----------

function openInFrame(service: GameService): void {
  currentService = service;
  const account = activeAccount();
  currentLaunchUrl = launchUrl(service, account);
  el("stage").hidden = false;
  (el("stage-title") as HTMLElement).textContent =
    `NOW PLAYING — ${service.name}` + (account ? ` as ${account.username}` : " (guest, no account)");
  const frame = el("game-frame") as HTMLIFrameElement;
  frame.src = currentLaunchUrl;
  // Move focus off the Play button (space would re-click it) and into the game.
  (document.activeElement as HTMLElement | null)?.blur?.();
  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
    } catch {
      /* cross-origin focus is best-effort */
    }
  };
  el("live").textContent = account
    ? `Progress will be saved to IndexedDB for ${account.username}.`
    : "No active account — select or create one to save progress.";
  el("stage").scrollIntoView({ behavior: "smooth", block: "start" });
}

// While a game is embedded, arrows/space belong to the game — stop them
// from scrolling the hub page (e.g. when focus is outside the iframe).
function wireScrollLock(): void {
  const GAME_KEYS = new Set([
    " ",
    "arrowup",
    "arrowdown",
    "arrowleft",
    "arrowright",
  ]);
  window.addEventListener(
    "keydown",
    (e) => {
      if (el("stage").hidden) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (GAME_KEYS.has(e.key.toLowerCase())) e.preventDefault();
    },
    { passive: false }
  );
}

function wireStage(): void {
  el("close-game").onclick = () => {
    el("stage").hidden = true;
    (el("game-frame") as HTMLIFrameElement).src = "about:blank";
    currentService = null;
    currentLaunchUrl = "";
    el("live").textContent = "";
  };
  el("open-tab").onclick = () => {
    if (currentLaunchUrl) window.open(currentLaunchUrl, "_blank", "noopener");
  };
}

// ---------- progress ----------

async function refreshProgress(): Promise<void> {
  const box = el("progress");
  const sess = el("sessions");
  box.innerHTML = "";
  sess.innerHTML = "";
  const account = activeAccount();
  if (!account) {
    box.innerHTML = `<p class="hint">Create + select an account to see its Space Shooter progress.</p>`;
    return;
  }
  const rows = await listProgressForAccount(account.id);
  const shoot = rows.find((r) => r.gameId === "space-shooter");
  const grid = document.createElement("div");
  grid.className = "stats";
  const cells: Array<[string, string]> = [
    [String(shoot?.highScore ?? 0), "HIGH"],
    [String(shoot?.totalPlays ?? 0), "PLAYS"],
    [String(shoot?.lastScore ?? 0), "LAST"],
    [
      shoot && shoot.totalPlays > 0
        ? String(Math.round(shoot.totalScore / shoot.totalPlays))
        : "—",
      "AVG",
    ],
  ];
  for (const [v, k] of cells) {
    const d = document.createElement("div");
    d.className = "stat";
    const b = document.createElement("b");
    b.textContent = v;
    const s = document.createElement("span");
    s.textContent = `${account.username} · ${k}`;
    d.append(b, s);
    grid.append(d);
  }
  box.append(grid);

  const history = await listSessions(account.id, "space-shooter", 8);
  if (history.length === 0) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = `No runs yet for ${account.username} — press Play to create the first session.`;
    box.append(p);
  } else {
    for (const h of history) {
      const li = document.createElement("li");
      li.textContent = `${new Date(h.playedAt).toLocaleString()} — score ${h.score}`;
      sess.append(li);
    }
  }
}

// ---------- incoming game events (postMessage from microservices) ----------

interface ShooterEvent {
  source?: string;
  type?: string;
  gameId?: string;
  score?: number;
}

function wireGameEvents(): void {
  window.addEventListener("message", async (ev: MessageEvent<ShooterEvent>) => {
    const msg = ev.data;
    if (!msg || msg.source !== "space-shooter") return;
    const account = activeAccount();
    if (msg.type === "SCORE_TICK" && typeof msg.score === "number") {
      el("live").textContent = account
        ? `🛰 ${account.username} playing… live score ${msg.score}`
        : `🛰 guest playing… live score ${msg.score}`;
      return;
    }
    if (msg.type === "GAME_OVER" && typeof msg.score === "number") {
      if (!account) {
        toast(`Game over — score ${msg.score} (no active account, not saved).`);
        el("live").textContent = `Game over — score ${msg.score}. Select an account to save runs.`;
        return;
      }
      const { progress } = await recordGameResult(account.id, "space-shooter", msg.score);
      toast(
        `💾 Saved: ${account.username} scored ${msg.score} (best ${progress.highScore}, ${progress.totalPlays} plays).`
      );
      el("live").textContent = `Game over — ${msg.score} saved to IndexedDB for ${account.username}.`;
      await refreshProgress();
    }
  });
}

// ---------- boot ----------

async function refreshAll(): Promise<void> {
  await refreshAccounts();
  await refreshServices();
  await refreshProgress();
}

async function boot(): Promise<void> {
  await ensureGameSeed(
    GAME_SERVICES.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      devUrl: s.devUrl,
    }))
  );
  // Guarantee progress rows for any pre-existing accounts.
  const existing = await listAccounts();
  for (const a of existing) await ensureProgress(a.id, "space-shooter");

  el("create").onclick = async () => {
    const input = el("username") as HTMLInputElement;
    try {
      const acc = await createAccount(input.value);
      input.value = "";
      activeId = acc.id;
      localStorage.setItem(ACTIVE_KEY, acc.id);
      toast(`Account "${acc.username}" created with a Space Shooter entry.`);
      await refreshAll();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not create account.");
    }
  };
  (el("username") as HTMLInputElement).addEventListener("keydown", (e) => {
    if (e.key === "Enter") (el("create") as HTMLButtonElement).click();
  });

  // Keep the stored latest progress visible even before any new run.
  if (activeId) {
    const p = await getProgress(activeId, "space-shooter").catch(() => null);
    if (!p) await ensureProgress(activeId, "space-shooter").catch(() => undefined);
  }

  wireStage();
  wireScrollLock();
  wireGameEvents();
  await refreshAll();
}

void boot();
