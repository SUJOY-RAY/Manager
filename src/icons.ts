// PNG icon set from public/icons — no emojis in the UI.
// Usage in static HTML: <span class="ic" data-icon="dashboard"></span>
// then hydrateIcons(root) once at boot. In TS: icon("play") -> img string.

const FILES: Record<string, string> = {
  dashboard: "dashboard.png",
  user: "user.png",
  users: "users.png",
  chart: "bar-chart.png",
  bell: "bell.png",
  bolt: "flash.png",
  menu: "menu.png",
  search: "loupe.png",
  play: "play.png",
  info: "information.png",
  external: "external.png",
  close: "close.png",
  // NOTE: filename on disk has a typo ("cheveron.png").
  chevron: "cheveron.png",
  lock: "lock.png",
  logout: "logout.png",
  trash: "trash.png",
  bulb: "lightbulb.png",
  check: "check.png",
  gamepad: "gamepad.png",
};

export type IconName = keyof typeof FILES;

export function iconSrc(name: IconName): string {
  return `/icons/${FILES[name]}`;
}

export function icon(name: IconName): string {
  const file = FILES[name];
  if (!file) return "";
  return `<img src="/icons/${file}" alt="" aria-hidden="true" draggable="false">`;
}

/** Replace every <span class="ic" data-icon="…"> with its <img>. */
export function hydrateIcons(root: ParentNode = document): void {
  for (const slot of root.querySelectorAll(".ic[data-icon]")) {
    const name = slot.getAttribute("data-icon") as IconName | null;
    if (name && name in FILES) slot.innerHTML = icon(name);
  }
}
