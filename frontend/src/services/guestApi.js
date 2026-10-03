const API_BASE = "http://localhost:5000/api";

function getToken() {
  try {
    const session = JSON.parse(sessionStorage.getItem("skynest_guest_session"));
    return session?.token || null;
  } catch {
    return null;
  }
}

function authHeaders() {
  const token = getToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function fetchGuestProfile() {
  const response = await fetch(`${API_BASE}/guests/me`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || "Failed to load profile.");
  }

  return response.json();
}

export async function updateGuestProfile(fields) {
  const response = await fetch(`${API_BASE}/guests/me`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(fields),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || "Failed to update profile.");
  }

  return response.json();
}
