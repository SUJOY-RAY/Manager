// Local persistence layer (IndexedDB). No backend — all game data,
// accounts and progress live in the browser.
// DB: game-manager-db
//   accounts : { id, username, createdAt }            (keyPath: id, unique index on username)
//   games    : { id, name, description, devUrl }     (keyPath: id)
//   progress : per (accountId, gameId, difficulty)   (unique index on [accountId+gameId+difficulty])
//   sessions : one row per finished run              (indexes on accountId, gameId, difficulty)

import type { Difficulty } from "./difficulty";
import { parseDifficulty } from "./difficulty";

export const DEFAULT_DIFFICULTY: Difficulty = "normal";

export function normalizeDifficulty(value: unknown): Difficulty {
  return parseDifficulty(value);
}

export interface Account {
  id: string;
  username: string;
  createdAt: number;
  /** "algo$hex" password hash. Absent for legacy password-less accounts. */
  passHash?: string;
}

export interface GameRecord {
  id: string;
  name: string;
  description: string;
  devUrl: string;
}

export interface Progress {
  id?: number;
  accountId: string;
  gameId: string;
  /** Per-game difficulty tier this aggregate covers. Legacy rows read as "normal". */
  difficulty: Difficulty;
  highScore: number;
  totalPlays: number;
  totalScore: number;
  lastScore: number;
  lastPlayedAt: number | null;
  updatedAt: number;
}

export interface GameSession {
  id?: number;
  accountId: string;
  gameId: string;
  /** Difficulty the run was played on. Legacy rows read as "normal". */
  difficulty: Difficulty;
  score: number;
  playedAt: number;
}

const DB_NAME = "game-manager-db";
const DB_VERSION = 2;

function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6)}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      const oldVersion = (ev as IDBVersionChangeEvent).oldVersion;
      if (!db.objectStoreNames.contains("accounts")) {
        const s = db.createObjectStore("accounts", { keyPath: "id" });
        s.createIndex("by-username", "username", { unique: true });
      }
      if (!db.objectStoreNames.contains("games")) {
        db.createObjectStore("games", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("progress")) {
        const s = db.createObjectStore("progress", {
          keyPath: "id",
          autoIncrement: true,
        });
        s.createIndex("by-account-game-difficulty", ["accountId", "gameId", "difficulty"], {
          unique: true,
        });
        s.createIndex("by-account", "accountId", { unique: false });
        s.createIndex("by-game", "gameId", { unique: false });
      } else if (oldVersion < 2) {
        // v1 -> v2: progress was unique on [accountId+gameId]; it is now
        // unique on [accountId+gameId+difficulty]. Legacy rows backfill to "normal".
        const t = req.transaction!;
        const s = t.objectStore("progress");
        if (s.indexNames.contains("by-account-game")) {
          s.deleteIndex("by-account-game");
        }
        if (!s.indexNames.contains("by-account-game-difficulty")) {
          s.createIndex("by-account-game-difficulty", ["accountId", "gameId", "difficulty"], {
            unique: true,
          });
        }
        const cursor = s.openCursor();
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (c) {
            const v = c.value as Partial<Progress>;
            if (!v.difficulty) {
              c.update({ ...v, difficulty: DEFAULT_DIFFICULTY });
            }
            c.continue();
          }
        };
      }
      if (!db.objectStoreNames.contains("sessions")) {
        const s = db.createObjectStore("sessions", {
          keyPath: "id",
          autoIncrement: true,
        });
        s.createIndex("by-account", "accountId", { unique: false });
        s.createIndex("by-game", "gameId", { unique: false });
        s.createIndex("by-played", "playedAt", { unique: false });
      } else if (oldVersion < 2) {
        const t = req.transaction!;
        const s = t.objectStore("sessions");
        const cursor = s.openCursor();
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (c) {
            const v = c.value as Partial<GameSession>;
            if (!v.difficulty) {
              c.update({ ...v, difficulty: DEFAULT_DIFFICULTY });
            }
            c.continue();
          }
        };
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  run: (t: IDBTransaction) => IDBRequest<T>
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    const req = run(t);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAll<T>(store: IDBObjectStore): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

// ---- accounts (simple username creation) ----

export async function createAccount(
  username: string,
  password: string
): Promise<Account> {
  const clean = username.trim().slice(0, 24);
  if (!clean) throw new Error("Username is required.");
  if (!/^[A-Za-z0-9 _-]+$/.test(clean)) {
    throw new Error("Use letters, numbers, spaces, - or _.");
  }
  if (password.length < 4) throw new Error("Password needs at least 4 characters.");
  if (password.length > 64) throw new Error("Password is too long (max 64).");
  const db = await openDb();
  try {
    const existing = await tx<Account | undefined>(
      db,
      ["accounts"],
      "readonly",
      (t) => t.objectStore("accounts").index("by-username").get(clean)
    );
    if (existing) throw new Error(`Account "${clean}" already exists.`);
    const { hashPassword } = await import("./auth");
    const account: Account = {
      id: makeId("acc"),
      username: clean,
      createdAt: Date.now(),
      passHash: await hashPassword(clean, password),
    };
    await tx(db, ["accounts"], "readwrite", (t) =>
      t.objectStore("accounts").add(account)
    );
    // Every new account gets fresh progress entries (all difficulties).
    await ensureProgressRow(db, account.id, "space-shooter", "easy");
    await ensureProgressRow(db, account.id, "space-shooter", "normal");
    await ensureProgressRow(db, account.id, "space-shooter", "hard");
    return account;
  } finally {
    db.close();
  }
}

export async function listAccounts(): Promise<Account[]> {
  const db = await openDb();
  try {
    return await tx<Account[]>(db, ["accounts"], "readonly", (t) =>
      t.objectStore("accounts").index("by-username").getAll() as unknown as IDBRequest<Account[]>
    );
  } finally {
    db.close();
  }
}

export async function deleteAccount(id: string): Promise<void> {
  const db = await openDb();
  try {
    const t = db.transaction(["accounts", "progress", "sessions"], "readwrite");
    await new Promise<void>((resolve, reject) => {
      const ops: IDBRequest[] = [t.objectStore("accounts").delete(id)];
      // cascade progress + sessions
      const progIdx = t.objectStore("progress").index("by-account");
      const sessIdx = t.objectStore("sessions").index("by-account");
      const killFor = (idx: IDBIndex) => {
        const cursor = idx.openCursor(IDBKeyRange.only(id));
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (c) {
            c.delete();
            c.continue();
          }
        };
      };
      killFor(progIdx);
      killFor(sessIdx);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      void ops;
    });
  } finally {
    db.close();
  }
}

// ---- games catalogue seed ----

export async function ensureGameSeed(games: GameRecord[]): Promise<void> {
  const db = await openDb();
  try {
    const t = db.transaction(["games"], "readwrite");
    await new Promise<void>((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      const store = t.objectStore("games");
      for (const g of games) store.put(g);
    });
  } finally {
    db.close();
  }
}

export async function listGames(): Promise<GameRecord[]> {
  const db = await openDb();
  try {
    const t = db.transaction(["games"], "readonly");
    return await getAll<GameRecord>(t.objectStore("games"));
  } finally {
    db.close();
  }
}

// ---- progress (per account × game × difficulty) ----

function ensureProgressRow(
  db: IDBDatabase,
  accountId: string,
  gameId: string,
  difficultyInput: unknown = DEFAULT_DIFFICULTY
): Promise<Progress> {
  const difficulty = normalizeDifficulty(difficultyInput);
  return new Promise((resolve, reject) => {
    const t = db.transaction(["progress"], "readwrite");
    const store = t.objectStore("progress");
    const getAllReq = store.getAll();
    getAllReq.onsuccess = () => {
      const rows = (getAllReq.result as Progress[]) ?? [];
      const found = rows.find(
        (r) =>
          r.accountId === accountId &&
          r.gameId === gameId &&
          normalizeDifficulty((r as Partial<Progress>).difficulty) === difficulty
      );
      if (found) {
        // Heal legacy rows that predate the difficulty column.
        if (!(found as Partial<Progress>).difficulty) {
          const healed: Progress = { ...found, difficulty };
          try {
            store.put(healed);
          } catch {
            /* healed on next write */
          }
          resolve(healed);
        } else {
          resolve(found);
        }
        return;
      }
      const fresh: Progress = {
        accountId,
        gameId,
        difficulty,
        highScore: 0,
        totalPlays: 0,
        totalScore: 0,
        lastScore: 0,
        lastPlayedAt: null,
        updatedAt: Date.now(),
      };
      const add = store.add(fresh);
      add.onsuccess = () => resolve({ ...fresh, id: add.result as number });
      add.onerror = () => reject(add.error);
    };
    getAllReq.onerror = () => reject(getAllReq.error);
  });
}

export async function ensureProgress(
  accountId: string,
  gameId: string,
  difficulty: Difficulty = DEFAULT_DIFFICULTY
): Promise<Progress> {
  const db = await openDb();
  try {
    return await ensureProgressRow(db, accountId, gameId, difficulty);
  } finally {
    db.close();
  }
}

export async function getProgress(
  accountId: string,
  gameId: string,
  difficulty: Difficulty = DEFAULT_DIFFICULTY
): Promise<Progress | null> {
  const db = await openDb();
  try {
    const t = db.transaction(["progress"], "readonly");
    const all = await getAll<Progress>(t.objectStore("progress"));
    const want = normalizeDifficulty(difficulty);
    return (
      all.find(
        (r) =>
          r.accountId === accountId &&
          r.gameId === gameId &&
          normalizeDifficulty((r as Partial<Progress>).difficulty) === want
      ) ?? null
    );
  } finally {
    db.close();
  }
}

export async function listProgressForAccount(accountId: string): Promise<Progress[]> {
  const db = await openDb();
  try {
    const t = db.transaction(["progress"], "readonly");
    const all = await getAll<Progress>(t.objectStore("progress"));
    return all
      .filter((r) => r.accountId === accountId)
      .map((r) => ({
        ...r,
        difficulty: normalizeDifficulty((r as Partial<Progress>).difficulty),
      }));
  } finally {
    db.close();
  }
}

/** Record a finished run: upserts the per-difficulty aggregate + appends a session row. */
export async function recordGameResult(
  accountId: string,
  gameId: string,
  score: number,
  difficultyInput: unknown = DEFAULT_DIFFICULTY
): Promise<{ progress: Progress; session: GameSession }> {
  const clean = Math.max(0, Math.floor(score));
  const difficulty = normalizeDifficulty(difficultyInput);
  const db = await openDb();
  try {
    const progress = await ensureProgressRow(db, accountId, gameId, difficulty);
    const next: Progress = {
      ...progress,
      difficulty,
      highScore: Math.max(progress.highScore, clean),
      totalPlays: progress.totalPlays + 1,
      totalScore: progress.totalScore + clean,
      lastScore: clean,
      lastPlayedAt: Date.now(),
      updatedAt: Date.now(),
    };
    const session: GameSession = {
      accountId,
      gameId,
      difficulty,
      score: clean,
      playedAt: Date.now(),
    };
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(["progress", "sessions"], "readwrite");
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.objectStore("progress").put(next);
      t.objectStore("sessions").add(session);
    });
    return { progress: next, session };
  } finally {
    db.close();
  }
}

export async function listSessions(
  accountId: string,
  gameId: string,
  limit = 10,
  difficulty?: Difficulty
): Promise<GameSession[]> {
  const db = await openDb();
  try {
    const t = db.transaction(["sessions"], "readonly");
    const all = await getAll<GameSession>(t.objectStore("sessions"));
    const want = difficulty === undefined ? undefined : normalizeDifficulty(difficulty);
    return all
      .filter((s) => s.accountId === accountId && s.gameId === gameId)
      .filter((s) =>
        want === undefined
          ? true
          : normalizeDifficulty((s as Partial<GameSession>).difficulty) === want
      )
      .map((s) => ({
        ...s,
        difficulty: normalizeDifficulty((s as Partial<GameSession>).difficulty),
      }))
      .sort((a, b) => b.playedAt - a.playedAt)
      .slice(0, limit);
  } finally {
    db.close();
  }
}

/** Every progress row on this device (all accounts × games × difficulties). */
export async function listAllProgress(): Promise<Progress[]> {
  const db = await openDb();
  try {
    const t = db.transaction(["progress"], "readonly");
    const all = await getAll<Progress>(t.objectStore("progress"));
    return all.map((r) => ({
      ...r,
      difficulty: normalizeDifficulty((r as Partial<Progress>).difficulty),
    }));
  } finally {
    db.close();
  }
}

/** Recent sessions for an account across ALL games, newest first. */
export async function listRecentSessions(
  accountId: string,
  limit = 25
): Promise<GameSession[]> {
  const db = await openDb();
  try {
    const t = db.transaction(["sessions"], "readonly");
    const all = await getAll<GameSession>(t.objectStore("sessions"));
    return all
      .filter((s) => s.accountId === accountId)
      .sort((a, b) => b.playedAt - a.playedAt)
      .slice(0, limit);
  } finally {
    db.close();
  }
}
