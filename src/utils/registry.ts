// Microservice registry: every playable game is an independent service.
// The hub (Manager) never bundles game code — it discovers, health-checks
// and embeds services via iframe + postMessage.

export interface GameService {
  id: string;
  name: string;
  description: string;
  /** Local dev URL of the independently-running game service. */
  devUrl: string;
  port: number;
  controls: string;
  accent: string;
  /** Card icon shown on the dashboard (served from the hub). */
  icon: string;
  genre: string;
  /** Short hover text explaining what clicking the card does. */
  blurb: string;
}

export const GAME_SERVICES: GameService[] = [
  {
    id: "space-shooter",
    name: "Space Shooter",
    description:
      "Canvas arcade shooter. Dodge, shoot, survive. Scores stream back to the hub.",
    devUrl: "http://localhost:5101",
    port: 5101,
    controls: "Arrows / WASD move · Space shoot · R restart · Q quit",
    accent: "#00dcff",
    icon: "/icons/space-shooter.svg",
    genre: "Arcade",
    blurb: "Click to launch Space Shooter in the hub player. Progress auto-saves to your active account.",
  },
];

/** Build the URL the hub embeds / opens for a given account. */
export function launchUrl(
  service: GameService,
  account?: { id: string; username: string } | null,
  difficulty?: string
): string {
  const url = new URL(service.devUrl);
  url.searchParams.set("embed", "1");
  url.searchParams.set("gameId", service.id);
  if (difficulty) url.searchParams.set("difficulty", difficulty);
  if (account) {
    url.searchParams.set("accountId", account.id);
    url.searchParams.set("accountName", account.username);
  }
  return url.toString();
}

/** Liveness probe for a game microservice (runs from the browser). */
export async function checkHealth(
  service: GameService,
  timeoutMs = 2500
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // `no-cors` is opaque but still rejects when nothing listens on the port,
    // which is all we need for an online/offline dot.
    await fetch(service.devUrl, { mode: "no-cors", signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
