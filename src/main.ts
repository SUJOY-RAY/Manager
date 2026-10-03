import { GAME_SERVICES, checkHealth, launchUrl, type GameService } from "./utils/registry";
import { createGameCard, filterServices } from "./dashboard";
import {
  DIFFICULTIES,
  difficultyLabel,
  getGameDifficulty,
  parseDifficulty,
  setGameDifficulty,
  type Difficulty,
} from "./utils/difficulty";
import {
  createAccount,
  deleteAccount,
  ensureGameSeed,
  ensureProgress,
  listAccounts,
  listSessions,
  listAllProgress,
  listProgressForAccount,
  getProgress,
  type Account,
} from "./utils/db";

import { verifyPassword } from "./utils/auth";
import { makeCollapsibleCard, type CollapsibleCard } from "./cards";
import { attachHoverPopup, esc, openMenu } from "./popup";
import { hydrateIcons, icon } from "./icons";
import { saveRun } from "./utils/storage";

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
  for (const s of GAME_SERVICES) {
    for (const d of DIFFICULTIES) await ensureProgress(accountId, s.id, d);
  }
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
        const sorted = [...rows].sort((x, y) =>
          x.gameId.localeCompare(y.gameId) ||
          DIFFICULTIES.indexOf(x.difficulty) - DIFFICULTIES.indexOf(y.difficulty)
        );
        for (const r of sorted) {
          const gameName =
            GAME_SERVICES.find((s) => s.id === r.gameId)?.name ?? r.gameId;
          const line = document.createElement("div");
          line.textContent =
            `${gameName} [${difficultyLabel(r.difficulty)}] — best ${r.highScore} · ` +
            `${r.totalPlays} play${r.totalPlays === 1 ? "" : "s"}`;
          detail.append(line);
        }
      } catch {
        detail.textContent = "Could not load progress.";
      }
    };
    name.onclick = () => {
      const open = Boolean(detail.hidden);
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
      use.innerHTML = "";
      if (a.passHash) {
        const ic = document.createElement("span");
        ic.className = "ic";
        ic.innerHTML = icon("lock");
        use.append(ic, document.createTextNode("Use"));
      } else {
        use.textContent = "Use";
      }
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
      out.className = "ghost icon-btn-sm";
      const outIc = document.createElement("span");
      outIc.className = "ic";
      outIc.innerHTML = icon("logout");
      out.append(outIc);
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
  // If a game is loaded, reload it silently so it carries the new account.
  if (currentService) {
    openInFrame(currentService, { reveal: false });
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
      onDifficulty: (svc, d) => {
        setGameDifficulty(svc.id, d);
        if (svc.id === selectedGameId) {
          selectedDifficulty = d;
          syncProgressDifficultySelect();
          void refreshProgress();
        }
        // Refresh bests + info panel so the new tier shows immediately.
        void refreshServices();
        const info = infoService ?? selectedGame();
        if (info.id === svc.id) void renderInfoPanel(info);
        if (currentService?.id === svc.id) openInFrame(svc, { reveal: false });
      },
    }, { difficulty: getGameDifficulty(s.id) });
    box.append(card.root);

    if (account) {
      const diff = getGameDifficulty(s.id);
      getProgress(account.id, s.id, diff)
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

async function renderBestBars(): Promise<void> {
  const box = el("best-bars");
  box.innerHTML = "";
  const rows = (await listAllProgress().catch(() => [])).filter(
    (r) => r.totalPlays > 0
  );
  if (rows.length === 0) {
    box.innerHTML = `<p class="hint">No scores yet — play a game to set the first best.</p>`;
    return;
  }
  const byName = new Map(accounts.map((a) => [a.id, a.username]));
  const sorted = [...rows].sort((a, b) => b.highScore - a.highScore);
  const max = Math.max(...sorted.map((r) => r.highScore), 1);
  for (const r of sorted) {
    const row = document.createElement("div");
    row.className = "bar-row";
    const label = document.createElement("span");
    label.className = "bar-label";
    label.textContent = `${byName.get(r.accountId) ?? "deleted"} · ${gameNameOf(r.gameId)} [${difficultyLabel(r.difficulty)}]`;
    label.title = label.textContent;
    const track = document.createElement("div");
    track.className = "bar-track";
    const fill = document.createElement("div");
    fill.className = "bar-fill";
    fill.style.width = "0%";
    track.append(fill);
    const val = document.createElement("span");
    val.className = "bar-value";
    val.textContent = String(r.highScore);
    row.append(label, track, val);
    box.append(row);
    const pct = Math.max(3, Math.round((r.highScore / max) * 100));
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      fill.style.width = `${pct}%`;
    } else {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          fill.style.width = `${pct}%`;
        })
      );
    }
  }
}

/** dd-mm-yyyy for the progress overview. */
function fmtDate(t: number | null | undefined): string {
  if (!t) return "—";
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

async function renderAllProgress(): Promise<void> {
  const tb = el("all-progress-tbody") as HTMLTableSectionElement;
  tb.innerHTML = "";
  const rows = await listAllProgress().catch(() => []);
  const byName = new Map(accounts.map((a) => [a.id, a.username]));
  const sorted = [...rows].sort((a, b) => {
    const an = byName.get(a.accountId) ?? "";
    const bn = byName.get(b.accountId) ?? "";
    return (
      an.localeCompare(bn) ||
      a.gameId.localeCompare(b.gameId) ||
      DIFFICULTIES.indexOf(a.difficulty) - DIFFICULTIES.indexOf(b.difficulty)
    );
  });
  if (sorted.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.className = "rec-when";
    td.textContent = "No progress on this device yet — play a game to create the first entry.";
    tr.append(td);
    tb.append(tr);
    return;
  }
  for (const r of sorted) {
    const tr = document.createElement("tr");
    const acc = document.createElement("td");
    acc.textContent = byName.get(r.accountId) ?? "deleted account";
    if (r.accountId === activeId) {
      acc.textContent += " ✓";
      acc.title = "Signed in";
    }
    const gm = document.createElement("td");
    gm.textContent = gameNameOf(r.gameId);
    const df = document.createElement("td");
    const dpill = document.createElement("span");
    dpill.className = `diff-pill diff-${r.difficulty}`;
    dpill.textContent = difficultyLabel(r.difficulty);
    df.append(dpill);
    const best = document.createElement("td");
    const pill = document.createElement("span");
    pill.className = "score-pill";
    pill.textContent = String(r.highScore);
    best.append(pill);
    const plays = document.createElement("td");
    plays.textContent = String(r.totalPlays);
    const when = document.createElement("td");
    when.className = "rec-when";
    when.textContent = fmtDate(r.lastPlayedAt);
    tr.append(acc, gm, df, best, plays, when);
    tb.append(tr);
  }
}

async function renderServicesMenu(): Promise<void> {
  const box = el("services-menu");
  box.innerHTML = "";
  const account = activeAccount();
  for (const s of GAME_SERVICES) {
    const row = document.createElement("div");
    row.className = "svc-row";
    const iconImg = document.createElement("img");
    iconImg.className = "svc-icon";
    iconImg.src = s.icon;
    iconImg.alt = "";
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
          icon: icon("play"),
          label: account
            ? `Play as ${account.username} [${difficultyLabel(getGameDifficulty(s.id))}]`
            : `Play here [${difficultyLabel(getGameDifficulty(s.id))}]`,
          onSelect: () => openInFrame(s),
        },
        {
          icon: icon("external"),
          label: "Open in new tab",
          onSelect: () =>
            window.open(
              launchUrl(s, activeAccount(), getGameDifficulty(s.id)),
              "_blank",
              "noopener"
            ),
        },
        { icon: icon("info"), label: "Details", onSelect: () => void renderInfoPanel(s, true) },
      ]);
    };
    row.append(iconImg, label, dot, kebab);
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
    });
  }
}

async function renderTopbar(): Promise<void> {
  const account = activeAccount();
  el("avatar-initials").textContent = account
    ? account.username.slice(0, 2).toUpperCase()
    : "–";
  el("avatar-name").textContent = account?.username ?? "Guest";
  // Badge = (game × difficulty) pairs where another account leads you.
  const badge = el("bell-badge");
  let surpassed = 0;
  if (account) {
    const rows = await listAllProgress().catch(() => []);
    for (const s of GAME_SERVICES) {
      for (const d of DIFFICULTIES) {
        const mine = rows.find(
          (r) => r.accountId === account.id && r.gameId === s.id && r.difficulty === d
        );
        if (!mine || mine.totalPlays === 0) continue;
        const bestOfRest = Math.max(
          0,
          ...rows
            .filter(
              (r) => r.accountId !== account.id && r.gameId === s.id && r.difficulty === d
            )
            .map((r) => r.highScore)
        );
        if (bestOfRest > mine.highScore) surpassed++;
      }
    }
  }
  badge.textContent = surpassed > 0 ? String(surpassed) : "";
  badge.hidden = surpassed === 0;
}

function wireConsole(): void {
  el("avatar-chip").onclick = (e) => {
    e.stopPropagation();
    openAccountMenu();
  };
  el("bell-btn").onclick = () => showView("progress");
}

// ---------- game info panel (right rail) ----------

let infoService: GameService | null = null;

async function renderInfoPanel(service: GameService, reveal = false): Promise<void> {
  infoService = service;
  const account = activeAccount();
  const difficulty = getGameDifficulty(service.id);
  (el("info-icon") as HTMLImageElement).src = service.icon;
  el("info-name").textContent = service.name;
  el("info-genre").textContent = service.genre;
  el("info-desc").textContent = `${service.description} ${service.blurb}`;
  el("info-controls").textContent = `Controls: ${service.controls}.`;
  (el("info-play") as HTMLButtonElement).textContent = account
    ? `▶ Play as ${account.username} [${difficultyLabel(difficulty)}]`
    : `▶ Play [${difficultyLabel(difficulty)}]`;
  syncInfoDifficultySelect(service.id);

  const dot = el("info-dot");
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
    if (infoService?.id === service.id) applyOnline(ok);
  });

  const best = el("info-best");
  best.textContent = "";
  if (account) {
    const p = await getProgress(account.id, service.id, difficulty).catch(() => null);
    if (infoService?.id !== service.id) return;
    best.textContent =
      p && p.totalPlays > 0
        ? `★ best ${p.highScore} [${difficultyLabel(difficulty)}]`
        : `★ no ${difficultyLabel(difficulty).toLowerCase()} runs yet`;
  }

  if (reveal) {
    // Info lives on the right — make sure its rail is visible.
    setRightbar(true);
    el("info-card").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function wireInfoPanel(): void {
  el("info-play").onclick = () => {
    if (infoService) openInFrame(infoService);
  };
  el("info-tab").onclick = () => {
    if (infoService)
      window.open(
        launchUrl(infoService, activeAccount(), getGameDifficulty(infoService.id)),
        "_blank",
        "noopener"
      );
  };
  (el("info-difficulty") as HTMLSelectElement).addEventListener("change", (e) => {
    if (!infoService) return;
    const d = parseDifficulty((e.target as HTMLSelectElement).value);
    setGameDifficulty(infoService.id, d);
    void refreshServices();
    void renderInfoPanel(infoService);
    syncGameDifficultySelect();
    if (currentService?.id === infoService.id) {
      openInFrame(infoService, { reveal: false });
    }
  });
}

function syncInfoDifficultySelect(gameId: string): void {
  const sel = el("info-difficulty") as HTMLSelectElement | null;
  if (!sel) return;
  if (sel.options.length === 0) {
    for (const d of DIFFICULTIES) {
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = difficultyLabel(d);
      sel.append(opt);
    }
  }
  const want = getGameDifficulty(gameId);
  if (sel.value !== want) sel.value = want;
}

// (Web save removed for now — everything persists locally via IndexedDB.)
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

type ViewName = "dashboard" | "accounts" | "progress" | "game";
let currentView: ViewName = "dashboard";

// Remember where the user is across reloads: the open game (if any) and the
// current view. Only explicit Back/Quit navigates away.
const VIEW_KEY = "gm.view";
const OPEN_GAME_KEY = "gm.openGameId";

function storeView(name: ViewName): void {
  try {
    localStorage.setItem(VIEW_KEY, name);
  } catch {
    /* ignore */
  }
}

function readStoredView(): ViewName | null {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === "dashboard" || v === "accounts" || v === "progress" || v === "game"
      ? v
      : null;
  } catch {
    return null;
  }
}

function storeOpenGame(gameId: string | null): void {
  try {
    if (gameId) localStorage.setItem(OPEN_GAME_KEY, gameId);
    else localStorage.removeItem(OPEN_GAME_KEY);
  } catch {
    /* ignore */
  }
}

function readStoredGame(): GameService | null {
  try {
    const id = localStorage.getItem(OPEN_GAME_KEY);
    return GAME_SERVICES.find((s) => s.id === id) ?? null;
  } catch {
    return null;
  }
}

function showView(name: ViewName): void {
  currentView = name;
  storeView(name);
  // The game gets its own full sub-screen: rails step aside while playing.
  document.body.classList.toggle("in-game", name === "game");
  el("view-dashboard").hidden = name !== "dashboard";
  el("view-accounts").hidden = name !== "accounts";
  el("view-progress").hidden = name !== "progress";
  el("view-game").hidden = name !== "game";
  (el("nav-games") as HTMLButtonElement).classList.toggle("active", name === "dashboard" || name === "game");
  (el("nav-progress") as HTMLButtonElement).classList.toggle("active", name === "progress" || name === "accounts");
  (el("nav-progress") as HTMLButtonElement).classList.toggle("active", name === "progress");
  // Left-menu navigation always lands at the top of the center box.
  document.querySelector("main")?.scrollTo({ top: 0 });
}

/** Boot navigation: reopen the stored game, or fall back to the stored view. */
function restoreView(): void {
  const stored = readStoredView();
  if (stored === "game") {
    // Accounts load after this (refreshAll); openInFrame first builds a guest
    // URL and refreshAccounts re-opens with the account URL once known.
    const svc = readStoredGame();
    if (svc) {
      openInFrame(svc);
      return;
    }
  }
  showView(stored ?? "dashboard");
}

// Account switching lives in the topbar avatar menu (no sidebar entry).
function openAccountMenu(): void {
  const anchor = el("avatar-chip");
  const items = accounts.map((a) => ({
    icon: a.id === activeId ? icon("check") : a.passHash ? icon("lock") : icon("user"),
    label: a.id === activeId ? `${a.username} (active)` : a.username,
    onSelect: () => {
      if (a.id === activeId) return;
      if (a.passHash) openAuthModal(a);
      else void selectAccount(a);
    },
  }));
  items.push({
    icon: icon("users"),
    label: "Manage accounts…",
    onSelect: () => showView("accounts"),
  });
  if (activeId) items.push({ icon: icon("logout"), label: "Sign out", onSelect: signOut });
  openMenu(anchor, items);
}

function wireNav(): void {
  el("nav-games").onclick = () => showView("dashboard");
  el("nav-progress").onclick = () => showView("progress");
  el("back-to-games").onclick = () => showView("dashboard");
  el("back-to-games-3").onclick = () => showView("dashboard");
}

function wireDashboardSearch(): void {
  const input = el("game-search") as HTMLInputElement;
  input.addEventListener("input", () => {
    dashboardQuery = input.value;
    void refreshServices();
  });
}

// ---------- dedicated game screen (redirect target for Play) ----------

function openInFrame(service: GameService, opts?: { reveal?: boolean }): void {
  const reveal = opts?.reveal ?? true;
  currentService = service;
  storeOpenGame(service.id);
  const account = activeAccount();
  const difficulty = getGameDifficulty(service.id);
  // The progress tracker follows the game being played.
  selectedGameId = service.id;
  selectedDifficulty = difficulty;
  syncProgressGameSelect();
  syncProgressDifficultySelect();
  void refreshProgress();
  const url = launchUrl(service, account, difficulty);
  const frame = el("game-frame") as HTMLIFrameElement;
  if (currentLaunchUrl !== url) {
    currentLaunchUrl = url;
    frame.src = url;
    // Move focus off the Play button (space would re-click it) and into the game.
    (document.activeElement as HTMLElement | null)?.blur?.();
    frame.onload = () => {
      try {
        frame.contentWindow?.focus();
      } catch {
        /* cross-origin focus is best-effort */
      }
    };
  }
  el("game-nav-title").textContent =
    service.name +
    ` [${difficultyLabel(difficulty)}]` +
    (account ? ` · ${account.username}` : " · guest");
  el("game-live").textContent = account
    ? `Saving locally for ${account.username} on ${difficultyLabel(difficulty)}.`
    : `Guest on ${difficultyLabel(difficulty)} — select an account to save progress.`;
  syncGameDifficultySelect();
  if (reveal) showView("game");
}

function syncGameDifficultySelect(): void {
  const sel = el("game-difficulty") as HTMLSelectElement | null;
  if (!sel || !currentService) return;
  if (sel.options.length === 0) {
    for (const d of DIFFICULTIES) {
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = difficultyLabel(d);
      sel.append(opt);
    }
  }
  const want = getGameDifficulty(currentService.id);
  if (sel.value !== want) sel.value = want;
}

function wireGameDifficultySelect(): void {
  (el("game-difficulty") as HTMLSelectElement).addEventListener("change", (e) => {
    if (!currentService) return;
    const d = parseDifficulty((e.target as HTMLSelectElement).value);
    setGameDifficulty(currentService.id, d);
    // Reload the frame on the new tier (a fresh run) + refresh hub bests.
    openInFrame(currentService, { reveal: false });
    void refreshServices();
    void renderInfoPanel(currentService);
  });
}

// While a game screen is open, arrows/space belong to the game — stop them
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
      if (currentView !== "game") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (GAME_KEYS.has(e.key.toLowerCase())) e.preventDefault();
    },
    { passive: false }
  );
}

/** Quit: unload the game and return to the dashboard. */
function quitGame(): void {
  (el("game-frame") as HTMLIFrameElement).src = "about:blank";
  currentService = null;
  currentLaunchUrl = "";
  storeOpenGame(null);
  el("game-live").textContent = "";
  showView("dashboard");
  toast("Quit to dashboard.");
}

function wireGameNav(): void {
  const wrap = el("game-stage");
  const toggle = el("game-nav-toggle") as HTMLButtonElement;
  const setOpen = (open: boolean) => {
    wrap.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));
  };
  // Corner-button toggle for touch/keyboard (hover reveals on desktop).
  toggle.onclick = (e) => {
    e.stopPropagation();
    setOpen(!wrap.classList.contains("open"));
    // A pointer click leaves focus on the button, and :focus-within would
    // then pin the bar open — release focus so hover alone governs it.
    // (Keyboard activation keeps focus so tabbing through still works.)
    if (e.detail > 0) toggle.blur();
  };
  // Auto-hide: tapping/clicking outside, tabbing away, focusing the game
  // itself, or Escape. (Focus is checked against the bar, not the stage —
  // focus landing in the game iframe must close the menu, not pin it.)
  const bar = el("game-navbar");
  document.addEventListener("pointerdown", (e) => {
    if (!wrap.contains(e.target as Node)) setOpen(false);
  });
  wrap.addEventListener("focusout", (e) => {
    // relatedTarget is null on programmatic blur() (e.g. right after the
    // toggle click releases focus) — that must not close the just-opened bar.
    const next = (e as FocusEvent).relatedTarget as Node | null;
    if (!next) return;
    if (!bar.contains(next)) setOpen(false);
  });
  // Clicking into the game frame blurs the outer window (no pointerdown
  // reaches this document) — treat that as dismissing the menu too.
  window.addEventListener("blur", () => setOpen(false));
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      setOpen(false);
      toggle.blur();
    }
  });
  // Back keeps the game loaded (resume via Play); Quit unloads it.
  // Blur the clicked button so :focus-within doesn't pin the bar open after.
  el("game-back").onclick = (e) => {
    setOpen(false);
    (e.currentTarget as HTMLElement).blur();
    showView("dashboard");
  };
  el("game-quit").onclick = (e) => {
    setOpen(false);
    (e.currentTarget as HTMLElement).blur();
    quitGame();
  };
  el("open-tab").onclick = (e) => {
    setOpen(false);
    (e.currentTarget as HTMLElement).blur();
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

let progressGen = 0;
// Difficulty the MY PROGRESS card is showing for the selected game.
let selectedDifficulty: Difficulty = "normal";

function syncProgressDifficultySelect(): void {
  const sel = el("progress-difficulty") as HTMLSelectElement | null;
  if (!sel) return;
  if (sel.options.length === 0) {
    for (const d of DIFFICULTIES) {
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = difficultyLabel(d);
      sel.append(opt);
    }
  }
  if (sel.value !== selectedDifficulty) sel.value = selectedDifficulty;
}

async function refreshProgress(): Promise<void> {
  // Generation guard: overlapping calls (tile click + refreshAll, select
  // change + game over…) interleave across awaits and would append twice.
  const gen = ++progressGen;
  const box = el("progress");
  const sess = el("sessions");
  box.innerHTML = "";
  sess.innerHTML = "";
  const account = activeAccount();
  const game = selectedGame();
  // MY PROGRESS is per-account — hide the whole card when logged out.
  el("progress-card").hidden = !account;
  progressCard?.setBadge(`${game.name} · ${difficultyLabel(selectedDifficulty)}`);
  if (!account) {
    box.innerHTML = `<p class="hint">Create + select an account to see its ${game.name} progress.</p>`;
    return;
  }
  const rows = await listProgressForAccount(account.id);
  if (gen !== progressGen) return;
  const prog = rows.find((r) => r.gameId === game.id && r.difficulty === selectedDifficulty);
  const plays = prog?.totalPlays ?? 0;
  const plural = plays === 1 ? "" : "s";
  const lastDate = prog?.lastPlayedAt
    ? new Date(prog.lastPlayedAt).toLocaleString()
    : "—";
  const diffName = difficultyLabel(selectedDifficulty);
  const grid = document.createElement("div");
  grid.className = "stats";
  const cells: Array<{ v: string; k: string; tip: string }> = [
    {
      v: String(prog?.highScore ?? 0),
      k: "HIGH",
      tip:
        `<b>HIGH · ${esc(game.name)} [${esc(diffName)}]</b><br>` +
        `Best of <b>${esc(account.username)}</b> on ${esc(diffName)}: ` +
        `<b>${prog?.highScore ?? 0}</b> across ${plays} play${plural}.`,
    },
    {
      v: String(plays),
      k: "PLAYS",
      tip:
        `<b>PLAYS · ${esc(game.name)} [${esc(diffName)}]</b><br>` +
        `${plays} finished ${esc(diffName.toLowerCase())} run${plural} saved locally for ` +
        `<b>${esc(account.username)}</b>.`,
    },
    {
      v: String(prog?.lastScore ?? 0),
      k: "LAST",
      tip:
        `<b>LAST · ${esc(game.name)} [${esc(diffName)}]</b><br>` +
        `Most recent ${esc(diffName.toLowerCase())} score: <b>${prog?.lastScore ?? 0}</b><br>${esc(lastDate)}.`,
    },
    {
      v: plays > 0 ? String(Math.round((prog?.totalScore ?? 0) / plays)) : "—",
      k: "AVG",
      tip:
        `<b>AVG · ${esc(game.name)} [${esc(diffName)}]</b><br>` +
        `Average over ${plays} ${esc(diffName.toLowerCase())} play${plural} ` +
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
    s.textContent = `${account.username} · ${diffName} · ${k}`;
    d.append(b, s);
    attachHoverPopup(d, () => tip);
    grid.append(d);
  }
  box.append(grid);

  // All tiers at a glance so every difficulty shows in progress.
  const byDiff = document.createElement("p");
  byDiff.className = "hint";
  byDiff.textContent = DIFFICULTIES.map((d) => {
    const r = rows.find((x) => x.gameId === game.id && x.difficulty === d);
    return `${difficultyLabel(d)} best ${r?.highScore ?? 0} · ${r?.totalPlays ?? 0} plays`;
  }).join(" — ");
  box.append(byDiff);

  const history = await listSessions(account.id, game.id, 8);
  if (gen !== progressGen) return;
  if (history.length === 0) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = `No ${game.name} runs yet for ${account.username} — press Play to create the first session.`;
    box.append(p);
  } else {
    for (const h of history) {
      const li = document.createElement("li");
      li.tabIndex = 0;
      li.textContent = `${new Date(h.playedAt).toLocaleString()} — [${difficultyLabel(h.difficulty)}] score ${h.score}`;
      attachHoverPopup(
        li,
        () =>
          `<b>${esc(game.name)} run [${esc(difficultyLabel(h.difficulty))}]</b><br>` +
          `Score <b>${h.score}</b><br>` +
          `${esc(new Date(h.playedAt).toLocaleString())}<br>` +
          `${esc(account.username)} · saved locally`
      );
      sess.append(li);
    }
  }
}

function wireProgressSelect(): void {
  (el("progress-game") as HTMLSelectElement).addEventListener("change", (e) => {
    selectedGameId = (e.target as HTMLSelectElement).value;
    // Follow the newly selected game's difficulty in the progress card.
    selectedDifficulty = getGameDifficulty(selectedGameId);
    syncProgressDifficultySelect();
    void refreshProgress();
  });
  (el("progress-difficulty") as HTMLSelectElement).addEventListener("change", (e) => {
    selectedDifficulty = parseDifficulty((e.target as HTMLSelectElement).value);
    void refreshProgress();
  });
}

// ---------- right sidebar (progress lives inside it) ----------

const RIGHTBAR_KEY = "gm.rightOpen";

function setRightbar(open: boolean): void {
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
}

function wireRightbar(): void {
  el("rightbar-toggle").onclick = () =>
    setRightbar(document.body.classList.contains("right-collapsed"));
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(RIGHTBAR_KEY);
  } catch {
    stored = null;
  }
  setRightbar(stored !== null ? stored === "1" : window.innerWidth > 1100);
}

// ---------- incoming game events (postMessage from microservices) ----------

interface ShooterEvent {
  source?: string;
  type?: string;
  gameId?: string;
  score?: number;
  difficulty?: string;
}

function wireGameEvents(): void {
  window.addEventListener("message", async (ev: MessageEvent<ShooterEvent>) => {
    const msg = ev.data;
    if (!msg || msg.source !== "space-shooter") return;
    const account = activeAccount();
    const eventDifficulty = parseDifficulty(msg.difficulty ?? getGameDifficulty(msg.gameId ?? selectedGameId));
    if (msg.type === "SCORE_TICK" && typeof msg.score === "number") {
      el("game-live").textContent = account
        ? `${account.username} playing [${difficultyLabel(eventDifficulty)}]… live score ${msg.score}`
        : `guest playing [${difficultyLabel(eventDifficulty)}]… live score ${msg.score}`;
      return;
    }
    if (msg.type === "DIFFICULTY" && msg.difficulty) {
      // Player picked a tier inside the game title screen — mirror it in the hub.
      const gid = msg.gameId && GAME_SERVICES.some((s) => s.id === msg.gameId)
        ? msg.gameId
        : (currentService?.id ?? selectedGameId);
      setGameDifficulty(gid, eventDifficulty);
      if (gid === selectedGameId) {
        selectedDifficulty = eventDifficulty;
        syncProgressDifficultySelect();
        void refreshProgress();
      }
      syncGameDifficultySelect();
      void refreshServices();
      if (infoService && infoService.id === gid) void renderInfoPanel(infoService);
      return;
    }
    if (msg.type === "QUIT_TO_HUB") {
      quitGame();
      return;
    }
    if (msg.type === "GAME_OVER" && typeof msg.score === "number") {
      if (!account) {
        toast(`Game over — score ${msg.score} (no active account, not saved).`);
        el("game-live").textContent = `Game over — score ${msg.score}. Select an account to save runs.`;
        return;
      }
      const gameId =
        msg.gameId && GAME_SERVICES.some((s) => s.id === msg.gameId)
          ? msg.gameId
          : "space-shooter";
      const { progress } = await saveRun(account.id, gameId, msg.score, eventDifficulty);
      toast(
        `Saved locally: ${account.username} scored ${msg.score} on ${difficultyLabel(eventDifficulty)} (best ${progress.highScore}, ${progress.totalPlays} plays).`
      );
      el("game-live").textContent = `Game over — ${msg.score} [${difficultyLabel(eventDifficulty)}] saved locally (IndexedDB) for ${account.username}.`;
      if (selectedGameId !== gameId) {
        selectedGameId = gameId;
        syncProgressGameSelect();
      }
      if (selectedDifficulty !== eventDifficulty) {
        selectedDifficulty = eventDifficulty;
        syncProgressDifficultySelect();
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
  syncProgressDifficultySelect();
  await refreshProgress();
  await renderBestBars();
  await renderAllProgress();
  await renderServicesMenu();
  await renderTopbar();
  const info = infoService ?? selectedGame();
  await renderInfoPanel(info);
}

async function boot(): Promise<void> {
  hydrateIcons(document);
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
      toast(`Account "${acc.username}" created with a Space Shooter entry.`);
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
      for (const d of DIFFICULTIES) {
        const p = await getProgress(activeId, s.id, d).catch(() => null);
        if (!p) await ensureProgress(activeId, s.id, d).catch(() => undefined);
      }
    }
  }

  // Progress card starts on the active game's difficulty.
  selectedDifficulty = getGameDifficulty(selectedGameId);

  wireGameNav();
  wireGameDifficultySelect();
  wireScrollLock();
  wireDashboardSearch();
  wireInfoPanel();
  wireAuth();
  wireSidebar();
  wireRightbar();
  wireNav();
  wireConsole();
  // Restore where the user was instead of resetting: reopen the current game
  // (the frame reloads its URL; the run itself restarts), or show the stored
  // view. Only explicit Back/Quit navigates away from here.
  restoreView();
  wireProgressSelect();
  refreshProgressGameOptions();
  wireGameEvents();
  await refreshAll();
}

void boot();
