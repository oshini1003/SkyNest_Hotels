import { authenticatedRequest } from "./session";

export function fetchGuestProfile() {
  return authenticatedRequest("guest", "/guests/me");
}

export function updateGuestProfile(fields) {
  return authenticatedRequest("guest", "/guests/me", {
    method: "PUT",
    body: JSON.stringify(fields),
  });
}
