// Per-game difficulty: picked per game in the hub, passed to the game
// service via ?difficulty=, echoed back in postMessage events, and stored
// per progress row / session so progress views can show it.

export type Difficulty = "easy" | "normal" | "hard";

export const DIFFICULTIES: readonly Difficulty[] = ["easy", "normal", "hard"];

export function parseDifficulty(value: unknown): Difficulty {
  if (typeof value === "string") {
    const v = value.toLowerCase();
    if (v === "easy" || v === "normal" || v === "hard") return v;
  }
  return "normal";
}

export function difficultyLabel(d: Difficulty): string {
  return d === "easy" ? "Easy" : d === "hard" ? "Hard" : "Normal";
}

const KEY_PREFIX = "gm.difficulty.";

export function getGameDifficulty(gameId: string): Difficulty {
  try {
    return parseDifficulty(localStorage.getItem(KEY_PREFIX + gameId));
  } catch {
    return "normal";
  }
}

export function setGameDifficulty(gameId: string, d: Difficulty): void {
  try {
    localStorage.setItem(KEY_PREFIX + gameId, d);
  } catch {
    /* private mode — session-only */
  }
}
