const KEY_PREFIX = "dns_guest_cred_";
const LEGACY_KEY_PREFIX = "dns_phone_cred_";

export interface StoredGuestSession {
  credential: string | null;
  visualId: string | null;
}

function parseStored(raw: string): StoredGuestSession {
  try {
    const parsed = JSON.parse(raw) as {
      guestCredential?: string;
      phoneCredential?: string;
      visualId?: string;
    };
    if (parsed && typeof parsed === "object") {
      return {
        credential: parsed.guestCredential || parsed.phoneCredential || null,
        visualId: parsed.visualId || null,
      };
    }
    return { credential: raw, visualId: null };
  } catch {
    return { credential: raw, visualId: null };
  }
}

/** Reads the canonical key, migrating the legacy one on first access. */
export function readGuestSession(id: string): StoredGuestSession {
  if (!id) return { credential: null, visualId: null };
  try {
    const key = `${KEY_PREFIX}${id}`;
    const legacyKey = `${LEGACY_KEY_PREFIX}${id}`;
    const raw = localStorage.getItem(key) ?? localStorage.getItem(legacyKey);
    if (!raw) return { credential: null, visualId: null };

    const stored = parseStored(raw);
    try {
      localStorage.setItem(
        key,
        JSON.stringify({ guestCredential: stored.credential, visualId: stored.visualId }),
      );
      localStorage.removeItem(legacyKey);
    } catch {}
    return stored;
  } catch {
    return { credential: null, visualId: null };
  }
}

export function writeGuestSession(
  id: string,
  credential: string,
  visualId?: string | null,
): void {
  if (!id) return;
  try {
    localStorage.setItem(
      `${KEY_PREFIX}${id}`,
      JSON.stringify({ guestCredential: credential, visualId: visualId ?? null }),
    );
    localStorage.removeItem(`${LEGACY_KEY_PREFIX}${id}`);
  } catch {}
}

export function clearGuestSession(id: string): void {
  if (!id) return;
  try {
    localStorage.removeItem(`${KEY_PREFIX}${id}`);
    localStorage.removeItem(`${LEGACY_KEY_PREFIX}${id}`);
  } catch {}
}
