import { authenticatedRequest, clearSession, readSession } from "./session";

async function changePassword(kind, currentPassword, newPassword) {
  const token = readSession(kind)?.token;
  const result = await authenticatedRequest(kind, `/auth/${kind}/password`, {
    method: "PUT",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  // A delayed response must not sign out a newer account/session.
  if (token && readSession(kind)?.token === token) {
    clearSession(kind, "Password changed. Please sign in with your new password.");
  }
  return result;
}

export function changeGuestPassword(currentPassword, newPassword) {
  return changePassword("guest", currentPassword, newPassword);
}

export function changeStaffPassword(currentPassword, newPassword) {
  return changePassword("staff", currentPassword, newPassword);
}
