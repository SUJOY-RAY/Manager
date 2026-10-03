// PNG icon set from public/icons — no emojis in the UI.
// Usage in static HTML: <span class="ic" data-icon="dashboard"></span>
// then hydrateIcons(root) once at boot. In TS: icon("play") -> img string.

const FILES: Record<string, string> = {
  dashboard: "component-icons/dashboard.png",
  user: "component-icons/user.png",
  users: "component-icons/users.png",
  chart: "component-icons/bar-chart.png",
  bell: "component-icons/bell.png",
  bolt: "component-icons/flash.png",
  menu: "component-icons/menu.png",
  search: "component-icons/loupe.png",
  play: "component-icons/play.png",
  info: "component-icons/information.png",
  external: "component-icons/external.png",
  close: "component-icons/close.png",
  chevron: "component-icons/cheveron.png",
  lock: "component-icons/lock.png",
  logout: "component-icons/logout.png",
  trash: "component-icons/trash.png",
  bulb: "component-icons/lightbulb.png",
  check: "component-icons/check.png",
  gamepad: "component-icons/gamepad.png",
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
