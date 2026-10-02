const API_BASE = "http://localhost:5000/api";

function getToken(sessionKey) {
  try {
    const session = JSON.parse(sessionStorage.getItem(sessionKey));
    return session?.token || null;
  } catch {
    return null;
  }
}

export async function changeGuestPassword(currentPassword, newPassword) {
  const token = getToken("skynest_guest_session");
  const response = await fetch(`${API_BASE}/auth/guest/password`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ currentPassword, newPassword }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || "Failed to change password.");
  }
  return response.json();
}

export async function changeStaffPassword(currentPassword, newPassword) {
  const token = getToken("skynest_staff_session");
  const response = await fetch(`${API_BASE}/auth/staff/password`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ currentPassword, newPassword }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || "Failed to change password.");
  }
  return response.json();
}
