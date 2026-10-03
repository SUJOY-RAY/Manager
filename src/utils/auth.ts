// Local account authentication: passwords are never stored — only a
// salted hash (SHA-256 via crypto.subtle, portable-hash fallback for
// non-secure contexts). All local: nothing leaves the browser.

export async function hashPassword(
  username: string,
  password: string
): Promise<string> {
  const salted = `${username.trim().toLowerCase()}::${password}`;
  const subtle = typeof crypto !== "undefined" ? crypto.subtle : undefined;
  if (subtle) {
    const digest = await subtle.digest(
      "SHA-256",
      new TextEncoder().encode(salted)
    );
    const hex = [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return `sha256$${hex}`;
  }
  return `fnv$${cyrb53(salted).toString(16)}`;
}

/** Accounts created before passwords existed have no hash — they unlock directly. */
export async function verifyPassword(
  username: string,
  password: string,
  passHash?: string
): Promise<boolean> {
  if (!passHash) return true;
  return (await hashPassword(username, password)) === passHash;
}

// Deterministic 53-bit fallback hash (only used where crypto.subtle is missing).
function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
