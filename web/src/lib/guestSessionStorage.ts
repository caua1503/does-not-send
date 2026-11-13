const KEY_PREFIX = "dns_guest_cred_";
const LEGACY_KEY_PREFIX = "dns_phone_cred_";

export interface StoredGuestSession {
  credential: string | null;
  visualId: string | null;
}

function parseStored(
  raw: string,
  allowPlainString: boolean,
): StoredGuestSession | null {
  const plain: StoredGuestSession | null = allowPlainString
    ? { credential: raw, visualId: null }
    : null;
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
    return plain;
  } catch {
    return plain;
  }
}

/** Reads the canonical key, migrating the legacy one on first access. */
export function readGuestSession(id: string): StoredGuestSession {
  if (!id) return { credential: null, visualId: null };
  try {
    const key = `${KEY_PREFIX}${id}`;
    const legacyKey = `${LEGACY_KEY_PREFIX}${id}`;
    const newRaw = localStorage.getItem(key);
    const legacyRaw = localStorage.getItem(legacyKey);
    const fromNew = newRaw ? parseStored(newRaw, false) : null;

    if (fromNew?.credential) {
      if (legacyRaw !== null) localStorage.removeItem(legacyKey);
      return fromNew;
    }

    // A broken/empty new key must not discard a still-valid legacy credential.
    const fromLegacy = legacyRaw ? parseStored(legacyRaw, true) : null;
    if (fromLegacy?.credential) {
      try {
        localStorage.setItem(
          key,
          JSON.stringify({
            guestCredential: fromLegacy.credential,
            visualId: fromLegacy.visualId,
          }),
        );
        localStorage.removeItem(legacyKey);
      } catch {}
      return fromLegacy;
    }

    if (legacyRaw !== null) localStorage.removeItem(legacyKey);
    return fromNew ?? fromLegacy ?? { credential: null, visualId: null };
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
