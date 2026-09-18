const API_BASE = "http://localhost:5000/api";
const SESSION_KEY = "skynest_guest_session";

async function requestGuestSession(path, body) {
  let response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new Error(
      "The account service is unavailable. Please try again later."
    );
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      data?.error || "Unable to process your request. Please try again."
    );
  }

  if (
    typeof data?.token !== "string" ||
    !data.token ||
    !data.guest?.guestId
  ) {
    throw new Error("The account service returned an unexpected response.");
  }

  return data;
}

export function loginGuest(username, password) {
  return requestGuestSession("/auth/guest/login", {
    username,
    password,
  });
}

export function registerGuest(details) {
  return requestGuestSession("/auth/guest/register", details);
}

export function readGuestSession() {
  try {
    const session = JSON.parse(sessionStorage.getItem(SESSION_KEY));
    return session?.token && session?.guest?.guestId ? session : null;
  } catch {
    return null;
  }
}

export function saveGuestSession(session) {
  sessionStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      token: session.token,
      guest: session.guest,
    })
  );
}

export function clearGuestSession() {
  sessionStorage.removeItem(SESSION_KEY);
}