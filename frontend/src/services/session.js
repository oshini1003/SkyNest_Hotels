export const API_BASE = (
  import.meta.env?.VITE_API_URL || "http://localhost:5000/api"
).replace(/\/$/, "");
export const SESSION_CHANGED_EVENT = "skynest:session-changed";

const SESSION_KEYS = {
  guest: "skynest_guest_session",
  staff: "skynest_staff_session",
};
const EXPIRY_MESSAGE = "Your session has expired. Please sign in again.";

function storedSession(kind) {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEYS[kind]));
  } catch {
    return null;
  }
}

// This only keeps the interface in sync with expiry. The server verifies tokens.
function expiryTime(token) {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(part));
    return Number.isFinite(payload.exp) ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

export function readSession(kind) {
  const session = storedSession(kind);
  return session?.token && expiryTime(session.token) > Date.now() ? session : null;
}

export function readSessionNotice(kind) {
  try {
    return sessionStorage.getItem(`${SESSION_KEYS[kind]}_notice`) || "";
  } catch {
    return "";
  }
}

export function saveSession(kind, session) {
  sessionStorage.setItem(SESSION_KEYS[kind], JSON.stringify(session));
  sessionStorage.removeItem(`${SESSION_KEYS[kind]}_notice`);
  window.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
}

export function clearSession(kind, notice = "") {
  sessionStorage.removeItem(SESSION_KEYS[kind]);
  if (notice) {
    sessionStorage.setItem(`${SESSION_KEYS[kind]}_notice`, notice);
  } else {
    sessionStorage.removeItem(`${SESSION_KEYS[kind]}_notice`);
  }
  window.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
}

export async function logoutSession(kind) {
  const refreshToken = storedSession(kind)?.refreshToken;
  clearSession(kind);
  if (!refreshToken) return;

  try {
    await fetch(`${API_BASE}/auth/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Local sign-out is complete even if the server cannot be reached.
  }
}

export function observeSessionExpiry() {
  let timer;
  function check() {
    window.clearTimeout(timer);
    let nextCheck = 60000;
    for (const kind of Object.keys(SESSION_KEYS)) {
      const session = storedSession(kind);
      if (!session) continue;
      const remaining = expiryTime(session.token) - Date.now();
      if (remaining <= 0) {
        clearSession(kind, EXPIRY_MESSAGE);
      } else {
        nextCheck = Math.min(nextCheck, remaining + 50);
      }
    }
    window.clearTimeout(timer);
    timer = window.setTimeout(check, nextCheck);
  }
  check();
  window.addEventListener("focus", check);
  window.addEventListener(SESSION_CHANGED_EVENT, check);
  return () => {
    window.clearTimeout(timer);
    window.removeEventListener("focus", check);
    window.removeEventListener(SESSION_CHANGED_EVENT, check);
  };
}

export async function authenticatedRequest(kind, path, options = {}) {
  const session = readSession(kind);
  if (!session) {
    clearSession(kind, EXPIRY_MESSAGE);
    throw new Error(EXPIRY_MESSAGE);
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
        Authorization: `Bearer ${session.token}`,
      },
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new Error("The account service is unavailable. Please try again later.");
  }

  const data = await response.json().catch(() => null);
  if (response.status === 401) {
    // A response from an older request must not clear a newer sign-in.
    if (storedSession(kind)?.token === session.token) {
      clearSession(kind, EXPIRY_MESSAGE);
    }
    throw new Error(EXPIRY_MESSAGE);
  }
  if (!response.ok) {
    throw new Error(data?.error || "Unable to complete your request. Please try again.");
  }
  if (!data) throw new Error("The account service returned an unexpected response.");
  return data;
}
