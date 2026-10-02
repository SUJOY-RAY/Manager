// Shared hover-popup: any element gets a floating details popup on
// hover/focus. Fixed-positioned so it escapes scrolling panes, flips to
// whichever viewport side has room.

let popupEl: HTMLDivElement | null = null;
let hideTimer = 0;

function ensurePopup(): HTMLDivElement {
  if (!popupEl) {
    popupEl = document.createElement("div");
    popupEl.className = "hover-popup";
    popupEl.hidden = true;
    document.body.append(popupEl);
    window.addEventListener("scroll", hidePopup, true);
    window.addEventListener("resize", hidePopup);
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") hidePopup();
    });
  }
  return popupEl;
}

export function hidePopup(): void {
  if (popupEl) popupEl.hidden = true;
  window.clearTimeout(hideTimer);
}

function placeNear(popup: HTMLDivElement, target: HTMLElement): void {
  const r = target.getBoundingClientRect();
  const pw = popup.offsetWidth;
  const ph = popup.offsetHeight;
  // Prefer opening toward the center (left of right-rail items).
  let left = r.left - pw - 10;
  if (left < 8) left = Math.min(r.right + 10, window.innerWidth - pw - 8);
  const top = Math.max(8, Math.min(r.top, window.innerHeight - ph - 8));
  popup.style.left = `${Math.max(8, left)}px`;
  popup.style.top = `${top}px`;
}

/** Escape for values interpolated into popup HTML. */
export function esc(value: string | number): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface MenuItem {
  icon?: string;
  label: string;
  onSelect: () => void;
}

/**
 * Clickable popup menu anchored to a button (the ••• pattern).
 * Closes on select, outside click, scroll or Escape.
 */
export function openMenu(anchor: HTMLElement, items: MenuItem[]): void {
  const popup = ensurePopup();
  popup.classList.add("menu");
  popup.innerHTML = "";
  for (const item of items) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "menu-item";
    if (item.icon) {
      const ic = document.createElement("span");
      ic.className = "menu-icon";
      ic.innerHTML = item.icon;
      b.append(ic);
    }
    const lb = document.createElement("span");
    lb.textContent = item.label;
    b.append(lb);
    b.onclick = (e) => {
      e.stopPropagation();
      hidePopup();
      item.onSelect();
    };
    popup.append(b);
  }
  popup.hidden = false;
  placeNear(popup, anchor);
  window.clearTimeout(hideTimer);
  window.setTimeout(() => {
    const onDoc = (e: PointerEvent) => {
      if (popup.hidden) {
        document.removeEventListener("pointerdown", onDoc);
        return;
      }
      if (popup.contains(e.target as Node) || anchor.contains(e.target as Node)) return;
      hidePopup();
      document.removeEventListener("pointerdown", onDoc);
    };
    document.addEventListener("pointerdown", onDoc);
  }, 0);
}

export function attachHoverPopup(
  target: HTMLElement,
  getHtml: () => string
): void {
  const show = () => {
    const popup = ensurePopup();
    popup.classList.remove("menu");
    popup.innerHTML = getHtml();
    popup.hidden = false;
    // Measure after unhide, then pin next to the target.
    placeNear(popup, target);
    window.clearTimeout(hideTimer);
  };
  const hideSoon = () => {
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hidePopup, 120);
  };
  target.addEventListener("mouseenter", show);
  target.addEventListener("mouseleave", hideSoon);
  target.addEventListener("focus", show);
  target.addEventListener("blur", hidePopup);
  // Keyboard/click toggle for touch users.
  target.addEventListener("click", (e) => {
    if (popupEl && !popupEl.hidden) hidePopup();
    else show();
    e.stopPropagation();
  });
}
