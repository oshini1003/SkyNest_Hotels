import { API_BASE, readSession, saveSession, clearSession } from "./session";

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
  const session = readSession("guest");
  return session?.guest?.guestId ? session : null;
}

export function saveGuestSession(session) {
  if (!session?.token || !session?.guest?.guestId) {
    throw new Error("Unable to save this guest session.");
  }
  try {
    saveSession("guest", {
      token: session.token,
      refreshToken: session.refreshToken,
      guest: session.guest,
    });
  } catch {
    throw new Error("Your browser could not save the guest session. Please check its storage settings.");
  }
}

export function clearGuestSession() {
  clearSession("guest");
}
