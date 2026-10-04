# Game Manager Hub

Central hub for the microservices-style game collection. Discovers game
services, embeds them in an iframe player, and persists per-account progress
locally (IndexedDB) — no backend.

## Quickstart

```sh
npm install
npm run dev        # hub :5000 + Space Shooter :5101 + Real Boxing :5102
```

Then open http://localhost:5000. The `dev` script prints a
`http://<lan-ip>:5000` URL too — open that on phones on the same Wi-Fi
(`localhost` on a phone means the phone itself, so it can never connect).
Allow Node/Vite through the Windows Firewall if the phone refuses to connect.

| Script        | What it does                                    |
| ------------- | ----------------------------------------------- |
| `dev`         | orchestrator: hub + all games, opens browsers   |
| `dev:hub`     | hub only (`vite --host --port 5000`)            |
| `dev:shooter` | Space Shooter only (`:5101`)                    |
| `dev:boxing`  | Real Boxing only (`:5102`)                      |
| `build`       | `tsc --noEmit && vite build`                    |
| `typecheck`   | `tsc --noEmit`                                  |

## How it works

- **Registry** (`src/utils/registry.ts`): the game catalogue. Each entry has
  an id, port, local `devUrl`, controls text, icon and genre. In production
  the URL comes from a `VITE_<GAME>_URL` env var (see below); locally it
  reuses the hub's own hostname + the game's port, so LAN play just works.
- **Player** (`src/main.ts` → `openInFrame`): embeds
  `<game-url>?embed=1&gameId=…&difficulty=…&accountId=…&accountName=…`.
- **Events**: games post progress back —
  `GAME_READY` / `SCORE_TICK` / `GAME_OVER` / `QUIT_TO_HUB` / `DIFFICULTY`
  with `{ source: <game-id>, gameId, score, difficulty }`. `GAME_OVER`
  with an active account is saved via `saveRun()` (IndexedDB).
- **Accounts & progress** (`src/utils/db.ts`): local accounts (hashed
  passwords), per-(account × game × difficulty) aggregates with best score,
  top-5 runs, play counts and session history. New accounts are seeded for
  every registered game.
- **Difficulties** (`src/utils/difficulty.ts`): per-game Easy/Normal/Hard,
  stored in `localStorage`, mirrored both ways with the games.

## Production env config (Vercel etc.)

Baked in at build time — redeploy the hub after changing:

```
VITE_SPACE_SHOOTER_URL=https://<shooter>.vercel.app
VITE_REAL_BOXING_URL=https://<boxing>.vercel.app
```

## Adding a game

1. Add an entry to `src/utils/registry.ts` (id, name, port, icon in
   `public/icons/`, controls, blurb) and `services.json`.
2. Serve it on its port with `host: true` (see any game's `vite.config.ts`).
3. Implement the query-param + postMessage protocol (copy
   `Space Shooter/src/manager-bridge.ts`).
4. Add a `dev:<game>` script here and to `scripts/dev-all.mjs`.

## Tech

Vite 5 + TypeScript (strict). No server code, no dependencies beyond the
dev toolchain — persistence is IndexedDB in the browser.
