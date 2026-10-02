// Local persistence layer (IndexedDB). No backend — all game data,
// accounts and progress live in the browser.
// DB: game-manager-db
//   accounts : { id, username, createdAt }            (keyPath: id, unique index on username)
//   games    : { id, name, description, devUrl }     (keyPath: id)
//   progress : per (accountId, gameId) aggregates    (unique index on [accountId+gameId])
//   sessions : one row per finished run              (indexes on accountId, gameId)

export interface Account {
  id: string;
  username: string;
  createdAt: number;
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
  score: number;
  playedAt: number;
}

const DB_NAME = "game-manager-db";
const DB_VERSION = 1;

function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6)}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
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
        s.createIndex("by-account-game", ["accountId", "gameId"], {
          unique: true,
        });
        s.createIndex("by-account", "accountId", { unique: false });
        s.createIndex("by-game", "gameId", { unique: false });
      }
      if (!db.objectStoreNames.contains("sessions")) {
        const s = db.createObjectStore("sessions", {
          keyPath: "id",
          autoIncrement: true,
        });
        s.createIndex("by-account", "accountId", { unique: false });
        s.createIndex("by-game", "gameId", { unique: false });
        s.createIndex("by-played", "playedAt", { unique: false });
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

export async function createAccount(username: string): Promise<Account> {
  const clean = username.trim().slice(0, 24);
  if (!clean) throw new Error("Username is required.");
  if (!/^[A-Za-z0-9 _-]+$/.test(clean)) {
    throw new Error("Use letters, numbers, spaces, - or _.");
  }
  const db = await openDb();
  try {
    const existing = await tx<Account | undefined>(
      db,
      ["accounts"],
      "readonly",
      (t) => t.objectStore("accounts").index("by-username").get(clean)
    );
    if (existing) throw new Error(`Account "${clean}" already exists.`);
    const account: Account = { id: makeId("acc"), username: clean, createdAt: Date.now() };
    await tx(db, ["accounts"], "readwrite", (t) =>
      t.objectStore("accounts").add(account)
    );
    // Every new account gets a fresh Space Shooter progress entry.
    await ensureProgressRow(db, account.id, "space-shooter");
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

// ---- progress ----

function ensureProgressRow(
  db: IDBDatabase,
  accountId: string,
  gameId: string
): Promise<Progress> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(["progress"], "readwrite");
    const store = t.objectStore("progress");
    const idx = store.index("by-account-game");
    const get = idx.get([accountId, gameId]);
    get.onsuccess = () => {
      const found = get.result as Progress | undefined;
      if (found) {
        resolve(found);
        return;
      }
      const fresh: Progress = {
        accountId,
        gameId,
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
    get.onerror = () => reject(get.error);
  });
}

export async function ensureProgress(
  accountId: string,
  gameId: string
): Promise<Progress> {
  const db = await openDb();
  try {
    return await ensureProgressRow(db, accountId, gameId);
  } finally {
    db.close();
  }
}

export async function getProgress(
  accountId: string,
  gameId: string
): Promise<Progress | null> {
  const db = await openDb();
  try {
    const row = await tx<Progress | undefined>(
      db,
      ["progress"],
      "readonly",
      (t) => t.objectStore("progress").index("by-account-game").get([accountId, gameId])
    );
    return row ?? null;
  } finally {
    db.close();
  }
}

export async function listProgressForAccount(accountId: string): Promise<Progress[]> {
  const db = await openDb();
  try {
    return await tx<Progress[]>(db, ["progress"], "readonly", (t) =>
      t.objectStore("progress").index("by-account").getAll(accountId) as unknown as IDBRequest<Progress[]>
    );
  } finally {
    db.close();
  }
}

/** Record a finished run: upserts the aggregate + appends a session row. */
export async function recordGameResult(
  accountId: string,
  gameId: string,
  score: number
): Promise<{ progress: Progress; session: GameSession }> {
  const clean = Math.max(0, Math.floor(score));
  const db = await openDb();
  try {
    const progress = await ensureProgressRow(db, accountId, gameId);
    const next: Progress = {
      ...progress,
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
  limit = 10
): Promise<GameSession[]> {
  const db = await openDb();
  try {
    const t = db.transaction(["sessions"], "readonly");
    const all = await getAll<GameSession>(t.objectStore("sessions"));
    return all
      .filter((s) => s.accountId === accountId && s.gameId === gameId)
      .sort((a, b) => b.playedAt - a.playedAt)
      .slice(0, limit);
  } finally {
    db.close();
  }
}
