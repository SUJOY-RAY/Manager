// Template-based game dashboard: every game microservice renders from the
// same card template — icon image, status, hover-to-explain overlay,
// click (or Enter) to navigate into the game.

import type { GameService } from "./registry";

export interface DashboardHandlers {
  onPlay: (service: GameService) => void;
  onOpenTab: (service: GameService) => void;
  onDetails: (service: GameService) => void;
}

/** Case-insensitive search across name, genre and description. */
export function filterServices(
  services: GameService[],
  query: string
): GameService[] {
  const q = query.trim().toLowerCase();
  if (!q) return services;
  return services.filter((s) =>
    `${s.name} ${s.genre} ${s.description}`.toLowerCase().includes(q)
  );
}

export interface GameCard {
  root: HTMLElement;
  setOnline: (online: boolean) => void;
  setBest: (highScore: number | null, plays: number) => void;
}

/** Build one dashboard card from the shared template. */
export function createGameCard(
  service: GameService,
  accountName: string | null,
  handlers: DashboardHandlers
): GameCard {
  const root = document.createElement("article");
  root.className = "game-tile";
  root.tabIndex = 0;
  root.setAttribute("role", "button");
  root.setAttribute(
    "aria-label",
    `Play ${service.name}${accountName ? ` as ${accountName}` : ""}`
  );
  root.style.setProperty("--tile-accent", service.accent);

  const dot = document.createElement("span");
  dot.className = "dot tile-status";
  dot.title = "Probing service…";

  const icon = document.createElement("img");
  icon.className = "tile-icon";
  icon.src = service.icon;
  icon.alt = `${service.name} icon`;
  icon.draggable = false;

  const name = document.createElement("h3");
  name.className = "tile-name";
  name.textContent = service.name;

  const best = document.createElement("span");
  best.className = "tile-best";
  best.textContent = "";

  const actions = document.createElement("div");
  actions.className = "tile-actions";

  // Info button: opens the full description in an exterior popup window.
  const info = document.createElement("button");
  info.className = "ghost tile-mini";
  info.textContent = "ⓘ";
  info.title = `About ${service.name} — details popup`;
  info.setAttribute("aria-label", `About ${service.name}`);
  info.onclick = (e) => {
    e.stopPropagation();
    handlers.onDetails(service);
  };

  const tab = document.createElement("button");
  tab.className = "ghost tile-mini";
  tab.textContent = "↗";
  tab.title = `Open ${service.name} in a new tab`;
  tab.setAttribute("aria-label", `Open ${service.name} in a new tab`);
  tab.onclick = (e) => {
    e.stopPropagation();
    handlers.onOpenTab(service);
  };
  actions.append(info, tab);

  // Hover / focus overlay: short navigate hint only.
  // The full description lives in the exterior popup (ⓘ button).
  const hover = document.createElement("div");
  hover.className = "tile-hover";
  const hoverCta = document.createElement("strong");
  hoverCta.textContent = accountName
    ? `▶ Click to play as ${accountName}`
    : "▶ Click to play";
  hover.append(hoverCta);

  root.append(dot, icon, name, best, actions, hover);

  const play = () => handlers.onPlay(service);
  root.addEventListener("click", play);
  root.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target === root) play();
    // Space on a focused card also launches (button-like), without scrolling.
    if (e.key === " " && e.target === root) {
      e.preventDefault();
      play();
    }
  });

  return {
    root,
    setOnline: (online: boolean) => {
      dot.classList.toggle("on", online);
      dot.classList.toggle("off", !online);
      dot.title = online
        ? `Online at ${service.devUrl}`
        : "Offline — run npm run dev in Manager to start it";
    },
    setBest: (highScore: number | null, plays: number) => {
      best.textContent =
        highScore !== null && plays > 0 ? `★ ${highScore}` : "★ new";
      best.title =
        plays > 0
          ? `Best score over ${plays} run${plays === 1 ? "" : "s"}`
          : "No runs yet for this account";
    },
  };
}
