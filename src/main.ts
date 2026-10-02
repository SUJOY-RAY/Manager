import "./styles.css";
import { GAME_SERVICES, checkHealth, launchUrl, type GameService } from "./registry";
import { createGameCard, filterServices } from "./dashboard";
import {
  createAccount,
  deleteAccount,
  ensureGameSeed,
  ensureProgress,
  listAccounts,
  listSessions,
  listRecentSessions,
  listProgressForAccount,
  getProgress,
  type Account,
  type GameSession,
} from "./db";
import {
  getSaveTarget,
  requestSaveTarget,
  saveRun,
  WEB_SAVE_TODO,
} from "./storage";
import { verifyPassword } from "./auth";
import { makeCollapsibleCard, type CollapsibleCard } from "./cards";
import { attachHoverPopup, esc, openMenu } from "./popup";

const ACTIVE_KEY = "gm.activeAccountId";

const el = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

let accounts: Account[] = [];
let activeId: string | null = localStorage.getItem(ACTIVE_KEY);
let currentService: GameService | null = null;
let currentLaunchUrl = "";
let accountsCard: CollapsibleCard | null = null;
let progressCard: CollapsibleCard | null = null;
// Which game's progress the right sidebar shows for the active account.
let selectedGameId = GAME_SERVICES[0]?.id ?? "space-shooter";

function selectedGame(): GameService {
  return GAME_SERVICES.find((s) => s.id === selectedGameId) ?? GAME_SERVICES[0]!;
}

async function ensureAllProgress(accountId: string): Promise<void> {
  for (const s of GAME_SERVICES) await ensureProgress(accountId, s.id);
}

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

async function selectAccount(a: Account): Promise<void> {
  activeId = a.id;
  localStorage.setItem(ACTIVE_KEY, a.id);
  await ensureAllProgress(a.id);
  toast(`Signed in as ${a.username}.`);
  await refreshAll();
}

function signOut(): void {
  activeId = null;
  localStorage.removeItem(ACTIVE_KEY);
  void refreshAll();
  toast("Signed out — select an account to keep saving progress.");
}

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
    // Expandable account cell: click the name to show per-game progress.
    name.classList.add("account-cell");
    name.title = "Click to expand account details";
    const detail = document.createElement("div");
    detail.className = "account-detail";
    detail.hidden = true;
    let detailLoaded = false;
    const loadDetail = async () => {
      if (detailLoaded) return;
      detailLoaded = true;
      try {
        const rows = await listProgressForAccount(a.id);
        if (rows.length === 0) {
          detail.textContent = "No progress yet — play a game to create the first entry.";
          return;
        }
        detail.innerHTML = "";
        for (const r of rows) {
          const gameName =
            GAME_SERVICES.find((s) => s.id === r.gameId)?.name ?? r.gameId;
          const line = document.createElement("div");
          line.textContent =
            `${gameName} — best ${r.highScore} · ` +
            `${r.totalPlays} play${r.totalPlays === 1 ? "" : "s"}`;
          detail.append(line);
        }
      } catch {
        detail.textContent = "Could not load progress.";
      }
    };
    name.onclick = () => {
      const open = detail.hidden;
      detail.hidden = !open;
      name.classList.toggle("open", open);
      if (open) void loadDetail();
    };
    const use = document.createElement("button");
    use.className = "ghost";
    if (a.id === activeId) {
      use.textContent = "Active ✓";
      use.disabled = true;
    } else {
      use.textContent = a.passHash ? "🔒 Use" : "Use";
      use.title = a.passHash ? "Password-protected — sign in to select" : "Select this account";
      use.onclick = () => {
        if (a.passHash) openAuthModal(a);
        else void selectAccount(a);
      };
    }
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
    if (a.id === activeId) {
      const out = document.createElement("button");
      out.className = "ghost";
      out.textContent = "⏻";
      out.title = "Sign out (switch account)";
      out.setAttribute("aria-label", `Sign out ${a.username}`);
      out.onclick = signOut;
      div.append(name, use, out, del);
    } else {
      div.append(name, use, del);
    }
    box.append(div, detail);
  }
  accountsCard?.setBadge(accounts.length > 0 ? String(accounts.length) : "");
  refreshNavAccounts();
  // If the game iframe is open, reload it so it carries the new account.
  if (currentService && currentLaunchUrl) {
    openInFrame(currentService);
  }
}

// ---------- game dashboard ----------

// Cached liveness so re-rendering on each search keystroke stays instant.
const healthCache = new Map<string, boolean>();
let dashboardQuery = "";

async function refreshServices(): Promise<void> {
  const box = el("services");
  box.innerHTML = "";
  const account = activeAccount();
  const services = filterServices(GAME_SERVICES, dashboardQuery);
  (el("no-games") as HTMLElement).hidden = services.length !== 0;

  for (const s of services) {
    const card = createGameCard(s, account?.username ?? null, {
      onPlay: (svc) => openInFrame(svc),
      onOpenTab: (svc) =>
        window.open(launchUrl(svc, activeAccount()), "_blank", "noopener"),
      onDetails: (svc) => void openGamePopup(svc),
    });
    box.append(card.root);

    const cached = healthCache.get(s.id);
    if (cached !== undefined) card.setOnline(cached);
    checkHealth(s).then((ok) => {
      healthCache.set(s.id, ok);
      card.setOnline(ok);
    });

    if (account) {
      getProgress(account.id, s.id)
        .then((p) =>
          card.setBest(p && p.totalPlays > 0 ? p.highScore : null, p?.totalPlays ?? 0)
        )
        .catch(() => card.setBest(null, 0));
    } else {
      card.setBest(null, 0);
    }
  }
  el("games-count").textContent =
    `${services.length} service${services.length === 1 ? "" : "s"}`;
}

// ---------- ops console (stats, records, service menus, tools) ----------

function gameNameOf(gameId: string): string {
  return GAME_SERVICES.find((s) => s.id === gameId)?.name ?? gameId;
}

function sessionRow(h: GameSession): HTMLTableRowElement {
  const tr = document.createElement("tr");
  const g = document.createElement("td");
  g.textContent = gameNameOf(h.gameId);
  const s = document.createElement("td");
  const pill = document.createElement("span");
  pill.className = "score-pill";
  pill.textContent = String(h.score);
  s.append(pill);
  const w = document.createElement("td");
  w.className = "rec-when";
  w.textContent = new Date(h.playedAt).toLocaleString();
  tr.append(g, s, w);
  return tr;
}

async function renderRecords(): Promise<void> {
  const tb = el("records-tbody") as HTMLTableSectionElement;
  tb.innerHTML = "";
  const account = activeAccount();
  if (!account) {
    el("records-sub").textContent = "Sign in to see run records.";
    return;
  }
  const rows = await listRecentSessions(account.id, 25).catch(() => []);
  el("records-sub").textContent =
    `${rows.length} run${rows.length === 1 ? "" : "s"} for ${account.username} · saved locally.`;
  for (const h of rows) tb.append(sessionRow(h));
}

async function renderServicesMenu(): Promise<void> {
  const box = el("services-menu");
  box.innerHTML = "";
  const account = activeAccount();
  for (const s of GAME_SERVICES) {
    const row = document.createElement("div");
    row.className = "svc-row";
    const icon = document.createElement("img");
    icon.className = "svc-icon";
    icon.src = s.icon;
    icon.alt = "";
    const label = document.createElement("div");
    label.className = "svc-label";
    const b = document.createElement("b");
    b.textContent = s.name;
    const sub = document.createElement("small");
    sub.textContent = `:${s.port} · probing…`;
    label.append(b, sub);
    const dot = document.createElement("span");
    dot.className = "dot";
    const kebab = document.createElement("button");
    kebab.className = "kebab";
    kebab.textContent = "•••";
    kebab.title = "More options";
    kebab.setAttribute("aria-label", `${s.name} options`);
    kebab.onclick = (e) => {
      e.stopPropagation();
      openMenu(kebab, [
        {
          icon: "▶",
          label: account ? `Play as ${account.username}` : "Play here",
          onSelect: () => openInFrame(s),
        },
        {
          icon: "↗",
          label: "Open in new tab",
          onSelect: () =>
            window.open(launchUrl(s, activeAccount()), "_blank", "noopener"),
        },
        { icon: "ⓘ", label: "Details", onSelect: () => void openGamePopup(s) },
      ]);
    };
    row.append(icon, label, dot, kebab);
    box.append(row);
    const cached = healthCache.get(s.id);
    const apply = (ok: boolean) => {
      dot.classList.toggle("on", ok);
      dot.classList.toggle("off", !ok);
      sub.textContent = ok ? `:${s.port} · online` : `:${s.port} · offline`;
    };
    if (cached !== undefined) apply(cached);
    checkHealth(s).then((ok) => {
      healthCache.set(s.id, ok);
      apply(ok);
      void renderStatus();
    });
  }
}

async function renderTopbar(): Promise<void> {
  const account = activeAccount();
  el("avatar-initials").textContent = account
    ? account.username.slice(0, 2).toUpperCase()
    : "–";
  el("avatar-name").textContent = account?.username ?? "Guest";
  el("tool-profile-sub").textContent = account
    ? `signed in as ${account.username}`
    : "no account — click to sign in";
  let today = 0;
  if (account) {
    const all = await listRecentSessions(account.id, 200).catch(() => []);
    const day = new Date().toDateString();
    today = all.filter((h) => new Date(h.playedAt).toDateString() === day).length;
  }
  for (const id of ["bell-badge", "tool-notif-badge"]) {
    const badge = el(id);
    badge.textContent = today > 0 ? String(today) : "";
    badge.hidden = today === 0;
  }
}

function wireConsole(): void {
  el("avatar-chip").onclick = () => showView("accounts");
  el("bell-btn").onclick = () => showView("records");
  el("tool-notif").onclick = () => showView("records");
  el("tool-profile").onclick = () => showView("accounts");
  el("tool-help").onclick = () =>
    toast("Move: Arrows/WASD · Shoot: Space · Restart: R · Quit: Q. Runs save locally per account.");
}

// ---------- exterior details popup ----------

let modalService: GameService | null = null;

async function openGamePopup(service: GameService): Promise<void> {
  modalService = service;
  const account = activeAccount();
  const overlay = el("game-modal");
  (el("modal-icon") as HTMLImageElement).src = service.icon;
  (el("modal-icon") as HTMLImageElement).alt = `${service.name} icon`;
  el("modal-name").textContent = service.name;
  el("modal-genre").textContent = service.genre;
  el("modal-desc").textContent = `${service.description} ${service.blurb}`;
  el("modal-controls").textContent = `Controls: ${service.controls}. Service: ${service.devUrl}`;
  (el("modal-play") as HTMLButtonElement).textContent = account
    ? `▶ Play as ${account.username}`
    : "▶ Play";

  const dot = el("modal-dot");
  dot.className = "dot";
  dot.title = "Probing service…";
  const cached = healthCache.get(service.id);
  const applyOnline = (ok: boolean) => {
    dot.classList.toggle("on", ok);
    dot.classList.toggle("off", !ok);
    dot.title = ok ? `Online at ${service.devUrl}` : "Offline";
  };
  if (cached !== undefined) applyOnline(cached);
  checkHealth(service).then((ok) => {
    healthCache.set(service.id, ok);
    if (modalService?.id === service.id) applyOnline(ok);
  });

  const best = el("modal-best");
  best.textContent = "";
  if (account) {
    const p = await getProgress(account.id, service.id).catch(() => null);
    if (modalService?.id !== service.id) return;
    best.textContent =
      p && p.totalPlays > 0 ? `★ best ${p.highScore}` : "★ no runs yet";
  }

  overlay.hidden = false;
  (el("modal-close") as HTMLButtonElement).focus();
}

function closeGamePopup(): void {
  el("game-modal").hidden = true;
  modalService = null;
}

function wireGamePopup(): void {
  el("modal-close").onclick = closeGamePopup;
  el("game-modal").addEventListener("click", (e) => {
    if (e.target === el("game-modal")) closeGamePopup();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !el("game-modal").hidden) closeGamePopup();
  });
  el("modal-play").onclick = () => {
    if (!modalService) return;
    const svc = modalService;
    closeGamePopup();
    openInFrame(svc);
  };
  el("modal-tab").onclick = () => {
    if (!modalService) return;
    window.open(launchUrl(modalService, activeAccount()), "_blank", "noopener");
  };
}

// ---------- save location (local live / web TODO) ----------

function refreshSaveSwitch(): void {
  const target = getSaveTarget();
  (el("save-local") as HTMLButtonElement).classList.toggle("active", target === "local");
  (el("save-web") as HTMLButtonElement).classList.toggle("active", target === "web");
  el("save-where").textContent = target === "local" ? "💾 LOCAL" : "☁️ WEB";
}

function wireSaveSwitch(): void {
  el("save-local").onclick = () => {
    requestSaveTarget("local");
    refreshSaveSwitch();
  };
  el("save-web").onclick = () => {
    requestSaveTarget("web"); // no-op until the web backend lands
    refreshSaveSwitch();
    toast(WEB_SAVE_TODO);
  };
}

// ---------- account sign-in (password gate for selecting an account) ----------

let authAccount: Account | null = null;

function openAuthModal(a: Account): void {
  authAccount = a;
  el("auth-sub").textContent = `Enter the password for ${a.username} to select this account.`;
  (el("auth-password") as HTMLInputElement).value = "";
  el("auth-modal").hidden = false;
  (el("auth-password") as HTMLInputElement).focus();
}

function closeAuthModal(): void {
  el("auth-modal").hidden = true;
  authAccount = null;
}

async function submitAuth(): Promise<void> {
  if (!authAccount) return;
  const pw = (el("auth-password") as HTMLInputElement).value;
  const ok = await verifyPassword(authAccount.username, pw, authAccount.passHash);
  if (!ok) {
    toast("Wrong password — try again.");
    (el("auth-password") as HTMLInputElement).value = "";
    (el("auth-password") as HTMLInputElement).focus();
    return;
  }
  const account = authAccount;
  closeAuthModal();
  await selectAccount(account);
}

function wireAuth(): void {
  el("auth-submit").onclick = () => void submitAuth();
  el("auth-cancel").onclick = closeAuthModal;
  el("auth-modal").addEventListener("click", (e) => {
    if (e.target === el("auth-modal")) closeAuthModal();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !el("auth-modal").hidden) closeAuthModal();
  });
  (el("auth-password") as HTMLInputElement).addEventListener("keydown", (e) => {
    if (e.key === "Enter") void submitAuth();
  });
}

// ---------- left sidebar (accounts live inside it) ----------

const SIDEBAR_KEY = "gm.sidebarOpen";

function isSidebarOpen(): boolean {
  return !document.body.classList.contains("sidebar-collapsed");
}

function applySidebar(open: boolean): void {
  document.body.classList.toggle("sidebar-collapsed", !open);
  (el("sidebar-toggle") as HTMLButtonElement).setAttribute(
    "aria-expanded",
    String(open)
  );
  try {
    localStorage.setItem(SIDEBAR_KEY, open ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function wireSidebar(): void {
  el("sidebar-toggle").onclick = () => applySidebar(!isSidebarOpen());
  el("hide-left").onclick = () => applySidebar(false);
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(SIDEBAR_KEY);
  } catch {
    stored = null;
  }
  // Default: open on wide screens, drawer-closed on narrow ones.
  applySidebar(stored !== null ? stored === "1" : window.innerWidth > 900);
}

// ---------- sub-page views (dashboard ⇄ accounts, like the game stage) ----------

type ViewName = "dashboard" | "accounts" | "records";
let currentView: ViewName = "dashboard";

function showView(name: ViewName): void {
  currentView = name;
  el("view-dashboard").hidden = name !== "dashboard";
  el("view-accounts").hidden = name !== "accounts";
  el("view-records").hidden = name !== "records";
  (el("nav-games") as HTMLButtonElement).classList.toggle("active", name === "dashboard");
  (el("nav-accounts") as HTMLButtonElement).classList.toggle("active", name === "accounts");
  (el("nav-records") as HTMLButtonElement).classList.toggle("active", name === "records");
  // Left-menu navigation always lands at the top of the center box.
  document.querySelector("main")?.scrollTo({ top: 0 });
}

function refreshNavAccounts(): void {
  const account = activeAccount();
  el("nav-accounts-sub").textContent = account
    ? `signed in as ${account.username}`
    : `${accounts.length} account${accounts.length === 1 ? "" : "s"} · click to manage`;
  const badge = el("nav-accounts-badge");
  badge.textContent = accounts.length > 0 ? String(accounts.length) : "";
  badge.hidden = accounts.length === 0;
}

function wireNav(): void {
  el("nav-games").onclick = () => showView("dashboard");
  el("nav-accounts").onclick = () => showView("accounts");
  el("nav-records").onclick = () => showView("records");
  el("back-to-games").onclick = () => showView("dashboard");
  el("back-to-games-2").onclick = () => showView("dashboard");
  el("view-all-records").onclick = () => showView("records");
}

function wireDashboardSearch(): void {
  const input = el("game-search") as HTMLInputElement;
  input.addEventListener("input", () => {
    dashboardQuery = input.value;
    void refreshServices();
  });
}

// ---------- stage (iframe embed) ----------

function openInFrame(service: GameService): void {
  currentService = service;
  showView("dashboard");
  const account = activeAccount();
  // The right sidebar follows the game being played.
  selectedGameId = service.id;
  syncProgressGameSelect();
  void refreshProgress();
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
    ? `Progress will save locally for ${account.username} (save: ${getSaveTarget()}).`
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

function closeStage(): void {
  if (el("stage").hidden) return;
  el("stage").hidden = true;
  (el("game-frame") as HTMLIFrameElement).src = "about:blank";
  currentService = null;
  currentLaunchUrl = "";
  el("live").textContent = "";
}

function wireStage(): void {
  el("close-game").onclick = closeStage;
  el("open-tab").onclick = () => {
    if (currentLaunchUrl) window.open(currentLaunchUrl, "_blank", "noopener");
  };
}

// ---------- progress (right sidebar, per selected game + account) ----------

function syncProgressGameSelect(): void {
  const sel = el("progress-game") as HTMLSelectElement;
  if (sel.value !== selectedGameId) sel.value = selectedGameId;
}

function refreshProgressGameOptions(): void {
  const sel = el("progress-game") as HTMLSelectElement;
  const keep = sel.value || selectedGameId;
  sel.innerHTML = "";
  for (const s of GAME_SERVICES) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.name;
    sel.append(opt);
  }
  selectedGameId = GAME_SERVICES.some((s) => s.id === keep)
    ? keep
    : (GAME_SERVICES[0]?.id ?? "space-shooter");
  sel.value = selectedGameId;
}

async function refreshProgress(): Promise<void> {
  const box = el("progress");
  const sess = el("sessions");
  box.innerHTML = "";
  sess.innerHTML = "";
  const account = activeAccount();
  const game = selectedGame();
  progressCard?.setBadge(game.name);
  if (!account) {
    box.innerHTML = `<p class="hint">Create + select an account to see its ${game.name} progress.</p>`;
    return;
  }
  const rows = await listProgressForAccount(account.id);
  const prog = rows.find((r) => r.gameId === game.id);
  const plays = prog?.totalPlays ?? 0;
  const plural = plays === 1 ? "" : "s";
  const lastDate = prog?.lastPlayedAt
    ? new Date(prog.lastPlayedAt).toLocaleString()
    : "—";
  const grid = document.createElement("div");
  grid.className = "stats";
  const cells: Array<{ v: string; k: string; tip: string }> = [
    {
      v: String(prog?.highScore ?? 0),
      k: "HIGH",
      tip:
        `<b>HIGH · ${esc(game.name)}</b><br>` +
        `Best of <b>${esc(account.username)}</b>: ` +
        `<b>${prog?.highScore ?? 0}</b> across ${plays} play${plural}.`,
    },
    {
      v: String(plays),
      k: "PLAYS",
      tip:
        `<b>PLAYS · ${esc(game.name)}</b><br>` +
        `${plays} finished run${plural} saved locally for ` +
        `<b>${esc(account.username)}</b>.`,
    },
    {
      v: String(prog?.lastScore ?? 0),
      k: "LAST",
      tip:
        `<b>LAST · ${esc(game.name)}</b><br>` +
        `Most recent score: <b>${prog?.lastScore ?? 0}</b><br>${esc(lastDate)}.`,
    },
    {
      v: plays > 0 ? String(Math.round((prog?.totalScore ?? 0) / plays)) : "—",
      k: "AVG",
      tip:
        `<b>AVG · ${esc(game.name)}</b><br>` +
        `Average over ${plays} play${plural} ` +
        `(total ${prog?.totalScore ?? 0}).`,
    },
  ];
  for (const { v, k, tip } of cells) {
    const d = document.createElement("div");
    d.className = "stat";
    d.tabIndex = 0;
    const b = document.createElement("b");
    b.textContent = v;
    const s = document.createElement("span");
    s.textContent = `${account.username} · ${k}`;
    d.append(b, s);
    attachHoverPopup(d, () => tip);
    grid.append(d);
  }
  box.append(grid);

  const history = await listSessions(account.id, game.id, 8);
  if (history.length === 0) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = `No ${game.name} runs yet for ${account.username} — press Play to create the first session.`;
    box.append(p);
  } else {
    for (const h of history) {
      const li = document.createElement("li");
      li.tabIndex = 0;
      li.textContent = `${new Date(h.playedAt).toLocaleString()} — score ${h.score}`;
      attachHoverPopup(
        li,
        () =>
          `<b>${esc(game.name)} run</b><br>` +
          `Score <b>${h.score}</b><br>` +
          `${esc(new Date(h.playedAt).toLocaleString())}<br>` +
          `${esc(account.username)} · saved locally 💾`
      );
      sess.append(li);
    }
  }
}

function wireProgressSelect(): void {
  (el("progress-game") as HTMLSelectElement).addEventListener("change", (e) => {
    selectedGameId = (e.target as HTMLSelectElement).value;
    void refreshProgress();
  });
}

// ---------- right sidebar (progress lives inside it) ----------

const RIGHTBAR_KEY = "gm.rightOpen";

function wireRightbar(): void {
  const apply = (open: boolean) => {
    document.body.classList.toggle("right-collapsed", !open);
    (el("rightbar-toggle") as HTMLButtonElement).setAttribute(
      "aria-expanded",
      String(open)
    );
    try {
      localStorage.setItem(RIGHTBAR_KEY, open ? "1" : "0");
    } catch {
      /* ignore */
    }
  };
  el("rightbar-toggle").onclick = () =>
    apply(document.body.classList.contains("right-collapsed"));
  el("hide-right").onclick = () => apply(false);
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(RIGHTBAR_KEY);
  } catch {
    stored = null;
  }
  apply(stored !== null ? stored === "1" : window.innerWidth > 1100);
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
    if (msg.type === "QUIT_TO_HUB") {
      closeStage();
      toast("Quit to dashboard.");
      el("stage").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (msg.type === "GAME_OVER" && typeof msg.score === "number") {
      if (!account) {
        toast(`Game over — score ${msg.score} (no active account, not saved).`);
        el("live").textContent = `Game over — score ${msg.score}. Select an account to save runs.`;
        return;
      }
      const gameId =
        msg.gameId && GAME_SERVICES.some((s) => s.id === msg.gameId)
          ? msg.gameId
          : "space-shooter";
      const { progress } = await saveRun(account.id, gameId, msg.score);
      toast(
        `💾 Saved locally: ${account.username} scored ${msg.score} (best ${progress.highScore}, ${progress.totalPlays} plays).`
      );
      el("live").textContent = `Game over — ${msg.score} saved locally (IndexedDB) for ${account.username}.`;
      if (selectedGameId !== gameId) {
        selectedGameId = gameId;
        syncProgressGameSelect();
      }
      await refreshAll();
    }
  });
}

// ---------- boot ----------

async function refreshAll(): Promise<void> {
  await refreshAccounts();
  await refreshServices();
  refreshProgressGameOptions();
  await refreshProgress();
  await renderStats();
  await renderRecent();
  await renderRecords();
  await renderServicesMenu();
  await renderTopbar();
  await renderStatus();
}

async function boot(): Promise<void> {
  accountsCard = makeCollapsibleCard("accounts", el("accounts-card"));
  progressCard = makeCollapsibleCard("progress", el("progress-card"));
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
  for (const a of existing) await ensureAllProgress(a.id);

  const submitCreate = async () => {
    const input = el("username") as HTMLInputElement;
    const pwInput = el("password") as HTMLInputElement;
    try {
      const acc = await createAccount(input.value, pwInput.value);
      input.value = "";
      pwInput.value = "";
      activeId = acc.id;
      localStorage.setItem(ACTIVE_KEY, acc.id);
      toast(`🔒 Account "${acc.username}" created with a Space Shooter entry.`);
      await refreshAll();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not create account.");
    }
  };
  el("create").onclick = () => void submitCreate();
  for (const id of ["username", "password"]) {
    (el(id) as HTMLInputElement).addEventListener("keydown", (e) => {
      if (e.key === "Enter") void submitCreate();
    });
  }

  // Keep the stored latest progress visible even before any new run.
  if (activeId) {
    for (const s of GAME_SERVICES) {
      const p = await getProgress(activeId, s.id).catch(() => null);
      if (!p) await ensureProgress(activeId, s.id).catch(() => undefined);
    }
  }

  wireStage();
  wireScrollLock();
  wireDashboardSearch();
  wireGamePopup();
  wireSaveSwitch();
  refreshSaveSwitch();
  wireAuth();
  wireSidebar();
  wireRightbar();
  wireNav();
  wireConsole();
  showView("dashboard");
  wireProgressSelect();
  refreshProgressGameOptions();
  wireGameEvents();
  await refreshAll();
}

void boot();
