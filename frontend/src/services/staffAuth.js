const API_BASE = "http://localhost:5000/api";
const SESSION_KEY = "skynest_staff_session";

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
  try {
    const session = JSON.parse(
      sessionStorage.getItem(SESSION_KEY)
    );

    return isStaffSession(session) ? session : null;
  } catch {
    return null;
  }
}

export function saveStaffSession(session) {
  if (!isStaffSession(session)) {
    throw new Error("Unable to save this staff session.");
  }

  try {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        token: session.token,
        staff: session.staff,
      })
    );
  } catch {
    throw new Error(
      "Your browser could not save the staff session. Please check its storage settings."
    );
  }
}

export function clearStaffSession() {
  sessionStorage.removeItem(SESSION_KEY);
}