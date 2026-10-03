import { API_BASE, readSession, saveSession, clearSession } from "./session";

const STAFF_ROLES = [
  "Admin",
  "Manager",
  "Receptionist",
  "ServiceStaff",
];

function isStaffSession(value) {
  return Boolean(
    typeof value?.token === "string" &&
    value.token.trim() !== "" &&
    value?.staff?.staffId &&
    typeof value.staff.name === "string" &&
    typeof value.staff.username === "string" &&
    STAFF_ROLES.includes(value.staff.role)
  );
}

export async function loginStaff(username, password) {
  let response;

  try {
    response = await fetch(`${API_BASE}/auth/staff/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new Error(
      "The staff sign-in service is unavailable. Please try again later."
    );
  }

  if (response.status === 401) {
    throw new Error("Invalid username or password.");
  }

  if (response.status === 403) {
    throw new Error(
      "This staff account cannot sign in. Please contact your administrator."
    );
  }

  if (!response.ok) {
    throw new Error(
      "The staff sign-in service is unavailable. Please try again later."
    );
  }

  const data = await response.json().catch(() => null);

  if (!isStaffSession(data)) {
    throw new Error(
      "The staff sign-in service returned an unexpected response."
    );
  }

  return data;
}

export function readStaffSession() {
  const session = readSession("staff");
  return isStaffSession(session) ? session : null;
}

export function saveStaffSession(session) {
  if (!isStaffSession(session)) {
    throw new Error("Unable to save this staff session.");
  }

  try {
    saveSession("staff", {
      token: session.token,
      refreshToken: session.refreshToken,
      staff: session.staff,
    });
  } catch {
    throw new Error(
      "Your browser could not save the staff session. Please check its storage settings."
    );
  }
}

export function clearStaffSession() {
  clearSession("staff");
}
