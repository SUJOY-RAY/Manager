// Save-location seam: progress currently persists to the LOCAL backend
// (IndexedDB, in this browser). The WEB backend (server/cloud sync) is an
// explicit TODO — the UI shows it, but selecting it explains that and keeps
// saving locally so no run is ever lost.

import {
  getProgress,
  listProgressForAccount,
  listSessions,
  recordGameResult,
} from "./db";

export type SaveTarget = "local" | "web";

const SAVE_TARGET_KEY = "gm.saveTarget";

export const WEB_SAVE_TODO =
  "☁️ Web save is a TODO — not wired yet. Progress keeps saving locally.";

export function getSaveTarget(): SaveTarget {
  try {
    return localStorage.getItem(SAVE_TARGET_KEY) === "web" ? "web" : "local";
  } catch {
    return "local";
  }
}

/** Only "local" is selectable for now; "web" stays a TODO. */
export function requestSaveTarget(target: SaveTarget): SaveTarget {
  if (target === "web") return "local"; // TODO: allow web once backend exists
  try {
    localStorage.setItem(SAVE_TARGET_KEY, target);
  } catch {
    /* private mode etc. — local default still applies */
  }
  return "local";
}

// ---------- local backend (live) ----------

export const localStore = {
  getProgress,
  listProgressForAccount,
  listSessions,
  recordGameResult,
};

// ---------- web backend (TODO) ----------

export interface WebRunPayload {
  accountId: string;
  gameId: string;
  score: number;
  playedAt: number;
}

/** TODO: implement when a server exists — POST run + merge aggregate. */
export async function recordGameResultWeb(
  _payload: WebRunPayload
): Promise<never> {
  throw new Error("TODO: web save backend not implemented yet");
}

/**
 * Single entry point for saving a finished run. Today this always writes
 * locally; when the web backend lands it will fan out based on getSaveTarget().
 */
export function saveRun(accountId: string, gameId: string, score: number) {
  if (getSaveTarget() === "web") {
    // Guard: unreachable via UI today, but never lose a run if it happens.
    return recordGameResult(accountId, gameId, score);
  }
  return recordGameResult(accountId, gameId, score);
}
