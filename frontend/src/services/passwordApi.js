import { authenticatedRequest, clearSession } from "./session";

async function changePassword(kind, currentPassword, newPassword) {
  const result = await authenticatedRequest(kind, `/auth/${kind}/password`, {
    method: "PUT",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  clearSession(kind, "Password changed. Please sign in with your new password.");
  return result;
}

export function changeGuestPassword(currentPassword, newPassword) {
  return changePassword("guest", currentPassword, newPassword);
}

export function changeStaffPassword(currentPassword, newPassword) {
  return changePassword("staff", currentPassword, newPassword);
}
