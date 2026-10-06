/**
 * Small helpers shared by the service modules. Internal; not exported from
 * the package root.
 */

/** `?a=1&b=2` from an object, skipping undefined/null/"" values. Arrays repeat the key. */
export function buildQuery(query) {
  if (!query || typeof query !== "object") return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const v of value) if (v !== undefined && v !== null && v !== "") params.append(key, String(v));
    } else if (typeof value === "object") {
      // Nested filters ride as prefixed keys: { cf: { featured: true } } -> cf_featured=true
      for (const [k, v] of Object.entries(value)) {
        if (v !== undefined && v !== null && v !== "") params.append(`${key}_${k}`, String(v));
      }
    } else {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** Throw a clear error when a required argument is missing. */
export function required(name, value) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

/** Path segment, URL-encoded, after a required check. */
export function seg(name, value) {
  return encodeURIComponent(String(required(name, value)));
}

/** Resolve a promise to null instead of throwing on 404. */
export async function orNull(promise) {
  try {
    return await promise;
  } catch (err) {
    if (err?.status === 404) return null;
    throw err;
  }
}

export const hasWindow = () => typeof window !== "undefined" && typeof document !== "undefined";

/** localStorage in the browser, an in-memory map elsewhere. Never throws. */
export function createStorage(custom) {
  if (custom && typeof custom.getItem === "function") return custom;
  const memory = new Map();
  const mem = {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => void memory.set(k, String(v)),
    removeItem: (k) => void memory.delete(k),
  };
  if (!hasWindow()) return mem;
  return {
    getItem(k) {
      try {
        return window.localStorage.getItem(k);
      } catch {
        return mem.getItem(k);
      }
    },
    setItem(k, v) {
      try {
        window.localStorage.setItem(k, v);
      } catch {
        mem.setItem(k, v);
      }
    },
    removeItem(k) {
      try {
        window.localStorage.removeItem(k);
      } catch {
        mem.removeItem(k);
      }
    },
  };
}

export function readJSON(storage, key, fallback = null) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJSON(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full / disabled */
  }
}

export function randomId(prefix = "") {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return prefix + crypto.randomUUID().replace(/-/g, "");
  } catch {
    /* fall through */
  }
  return prefix + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** The visitor asked not to be tracked (DNT or Global Privacy Control). */
export function doNotTrack() {
  if (typeof navigator === "undefined") return false;
  const dnt = navigator.doNotTrack || (hasWindow() ? window.doNotTrack : undefined) || navigator.msDoNotTrack;
  return dnt === "1" || dnt === "yes" || navigator.globalPrivacyControl === true;
}

// ─── Cookies (first-party, browser only; server reads are by header) ──────

export function getCookie(name, cookieHeader) {
  const source = cookieHeader ?? (hasWindow() ? document.cookie : "");
  if (!source) return null;
  for (const part of String(source).split(/;\s*/)) {
    const idx = part.indexOf("=");
    if (idx > 0 && part.slice(0, idx) === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1));
      } catch {
        return part.slice(idx + 1);
      }
    }
  }
  return null;
}

export function setCookie(name, value, { days = 30, path = "/", domain, sameSite = "Lax" } = {}) {
  if (!hasWindow()) return;
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  const secure = window.location?.protocol === "https:" ? "; Secure" : "";
  const dom = domain ? `; Domain=${domain}` : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; Expires=${expires}; Path=${path}${dom}; SameSite=${sameSite}${secure}`;
}
