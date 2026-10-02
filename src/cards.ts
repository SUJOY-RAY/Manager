// Reusable collapsible-card factory. Every hub section (accounts,
// dashboard, stage, progress) is built with this — same header/body
// template, per-card open state persisted in localStorage.

export interface CollapsibleCard {
  root: HTMLElement;
  body: HTMLElement;
  isOpen: () => boolean;
  setOpen: (open: boolean) => void;
  setBadge: (text: string) => void;
}

const keyOf = (id: string) => `gm.card.${id}`;

function storedOpen(id: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(keyOf(id));
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

/**
 * Turn an existing <section class="card"> into a collapsible card:
 * its <h2> becomes the header title (a live h2 with an id is kept live),
 * remaining children move into the collapsible body.
 */
export function makeCollapsibleCard(
  id: string,
  section: HTMLElement,
  opts?: { defaultOpen?: boolean }
): CollapsibleCard {
  const fallback = opts?.defaultOpen ?? true;
  section.classList.add("collapse-card");

  const h2 = section.querySelector("h2");
  const titleText = h2?.textContent?.trim() ?? id;

  const head = document.createElement("button");
  head.type = "button";
  head.className = "card-head";
  head.setAttribute("aria-expanded", "true");

  const chev = document.createElement("span");
  chev.className = "chev";
  chev.textContent = "▼";

  const badge = document.createElement("span");
  badge.className = "card-badge";
  badge.hidden = true;

  if (h2 && h2.id) {
    // Live title (e.g. NOW PLAYING) — keep the real node in the header.
    h2.classList.add("card-title-live");
    head.append(chev, h2, badge);
  } else {
    h2?.remove();
    const title = document.createElement("span");
    title.className = "card-title";
    title.textContent = titleText;
    head.append(chev, title, badge);
  }

  const body = document.createElement("div");
  body.className = "card-body";
  while (section.firstChild) body.append(section.firstChild);
  section.append(head, body);

  const card: CollapsibleCard = {
    root: section,
    body,
    isOpen: () => !section.classList.contains("closed"),
    setOpen: (open: boolean) => {
      section.classList.toggle("closed", !open);
      head.setAttribute("aria-expanded", String(open));
      try {
        localStorage.setItem(keyOf(id), open ? "1" : "0");
      } catch {
        /* ignore */
      }
    },
    setBadge: (text: string) => {
      badge.textContent = text;
      badge.hidden = text.length === 0;
    },
  };

  head.onclick = () => card.setOpen(!card.isOpen());
  card.setOpen(storedOpen(id, fallback));
  return card;
}
