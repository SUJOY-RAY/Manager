// Template-based game dashboard: every game microservice renders from the
// same card template — icon image, status, hover-to-explain overlay,
// click (or Enter) to navigate into the game.

import type { GameService } from "./utils/registry";
import {
  DIFFICULTIES,
  difficultyLabel,
  type Difficulty,
} from "./utils/difficulty";

export interface DashboardHandlers {
  onPlay: (service: GameService) => void;
  onDifficulty?: (service: GameService, difficulty: Difficulty) => void;
}

export interface DashboardOptions {
  difficulty?: Difficulty;
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
  setBest: (highScore: number | null, plays: number) => void;
}

/** Build one dashboard card from the shared template. */
export function createGameCard(
  service: GameService,
  accountName: string | null,
  handlers: DashboardHandlers,
  opts?: DashboardOptions
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

  const best = document.createElement("span");
  best.className = "tile-best";
  best.textContent = "";

  // Per-game difficulty picker. Clicks/keys here must not launch the game.
  const diffWrap = document.createElement("label");
  diffWrap.className = "tile-diff";
  const diffSelect = document.createElement("select");
  diffSelect.className = "tile-diff-select";
  diffSelect.setAttribute("aria-label", `Difficulty for ${service.name}`);
  diffSelect.title = `Difficulty for ${service.name}`;
  for (const d of DIFFICULTIES) {
    const opt = document.createElement("option");
    opt.value = d;
    opt.textContent = difficultyLabel(d);
    diffSelect.append(opt);
  }
  diffSelect.value = opts?.difficulty ?? "normal";
  diffSelect.addEventListener("click", (e) => e.stopPropagation());
  diffSelect.addEventListener("pointerdown", (e) => e.stopPropagation());
  diffSelect.addEventListener("keydown", (e) => e.stopPropagation());
  diffSelect.addEventListener("change", (e) => {
    e.stopPropagation();
    handlers.onDifficulty?.(service, diffSelect.value as Difficulty);
  });
  diffWrap.append(diffSelect);

  // Hover / focus overlay: short navigate hint only.
  // Details live in the right-rail Game Info panel + ••• menus.
  const hover = document.createElement("div");
  hover.className = "tile-hover";
  const hoverCta = document.createElement("strong");
  hoverCta.textContent = accountName
    ? `▶ Click to play as ${accountName}`
    : "▶ Click to play";
  hover.append(hoverCta);

  root.append(icon, name, best, diffWrap, hover);

  const play = () => handlers.onPlay(service);
  root.addEventListener("click", (e) => {
    // The difficulty select lives inside the tile — don't launch from it.
    if ((e.target as HTMLElement).closest(".tile-diff")) return;
    play();
  });
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
    setBest: (highScore: number | null, plays: number) => {
      const diff = difficultyLabel(diffSelect.value as Difficulty);
      best.textContent =
        highScore !== null && plays > 0 ? `★ ${highScore} · ${diff}` : `★ new · ${diff}`;
      best.title =
        plays > 0
          ? `Best score on ${diff} over ${plays} run${plays === 1 ? "" : "s"}`
          : `No ${diff} runs yet for this account`;
    },
  };
}
