// Template-based game dashboard: every game microservice renders from the
// same card template — icon image, status, hover-to-explain overlay,
// click (or Enter) to navigate into the game.

import type { GameService } from "./utils/registry";

export interface DashboardHandlers {
  onPlay: (service: GameService) => void;
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

  const icon = document.createElement("img");
  icon.className = "tile-icon";
  icon.src = service.icon;
  icon.alt = `${service.name} icon`;
  icon.draggable = false;

  const name = document.createElement("h3");
  name.className = "tile-name";
  name.textContent = service.name;

  // Hover / focus overlay: short navigate hint only.
  // Details live in the right-rail Game Info panel + ••• menus.
  const hover = document.createElement("div");
  hover.className = "tile-hover";
  const hoverCta = document.createElement("strong");
  hoverCta.textContent = accountName
    ? `▶ Click to play as ${accountName}`
    : "▶ Click to play";
  hover.append(hoverCta);

  root.append(icon, name, hover);

  const play = () => handlers.onPlay(service);
  root.addEventListener("click", play);
  root.addEventListener("keydown", (e) => {
    if (e.target !== root) return;
    if (e.key === "Enter") play();
    // Space on a focused card also launches (button-like), without scrolling.
    if (e.key === " ") {
      e.preventDefault();
      play();
    }
  });

  return {
    root,
  };
}
