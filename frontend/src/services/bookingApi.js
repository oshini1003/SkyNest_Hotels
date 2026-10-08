import { API_BASE, clearSession, readSession } from "./session";

const expiryMessage = "Your session has expired. Please sign in again.";
const uncertainMessage = "We could not confirm the result. Check My bookings before trying again; the request may already have been saved.";

function failure(message, status = 0, outcomeUnknown = false) {
  return Object.assign(new Error(message), { status, outcomeUnknown });
}

export function isCurrentGuest(token) {
  return Boolean(token) && readSession("guest")?.token === token;
}

async function request(path, { token, signal, method = "GET", body } = {}) {
  if (!isCurrentGuest(token)) throw failure(expiryMessage, 401);
  const mutation = method !== "GET";
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 10000);
  let response;
  let data;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: "no-store",
      signal: controller.signal,
    });
    data = await response.json().catch(() => null);
  } catch {
    if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
    throw failure(mutation ? uncertainMessage : "The booking service is unavailable. Please try again.", 0, mutation);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
  // Neither return another guest's data nor let an old 401 clear a new sign-in.
  if (!isCurrentGuest(token)) throw new DOMException("Session changed", "AbortError");
  if (response.status === 401) {
    clearSession("guest", expiryMessage);
    throw failure(expiryMessage, 401);
  }
  if (!response.ok) {
    const unknown = mutation && response.status >= 500;
    throw failure(unknown ? uncertainMessage : (typeof data?.error === "string" ? data.error : "Unable to complete this request."), response.status, unknown);
  }
  if (!data) throw failure(mutation ? uncertainMessage : "The booking service returned an unexpected response.", response.status, mutation);
  return data;
}

export async function loadBookingGuest(token, signal) {
  const data = await request("/guests/me", { token, signal });
  if (!data.GuestID || typeof data.Name !== "string") throw failure("Unable to load your guest profile.");
  return data;
}

export async function loadMyBookings(token, signal) {
  const data = await request("/bookings", { token, signal });
  if (!Array.isArray(data) || data.some((booking) => !Number.isSafeInteger(booking.BookingID) || !Array.isArray(booking.rooms))) {
    throw failure("The booking service returned an unexpected response.");
  }
  return data;
}

export async function createGuestBooking(details, token, signal) {
  const data = await request("/bookings", { method: "POST", body: details, token, signal });
  if (!Number.isSafeInteger(data.bookingId) || data.bookingId < 1 || data.status !== "Booked") {
    throw failure(uncertainMessage, 0, true);
  }
  return data;
}

// Changes one room entry of a Booked reservation. `changes` holds bookedRoomId plus
// any of roomId, checkin, checkout and guestCount.
export async function updateGuestBooking(bookingId, changes, token, signal) {
  const data = await request(`/bookings/${bookingId}`, { method: "PATCH", body: changes, token, signal });
  if (data.bookingId !== bookingId || data.updated !== true) {
    throw failure(uncertainMessage, 0, true);
  }
  return data;
}

export async function cancelGuestBooking(bookingId, token, signal) {
  const data = await request(`/bookings/${bookingId}/cancel`, { method: "PATCH", token, signal });
  if (data.bookingId !== bookingId || data.status !== "Cancelled") {
    throw failure(uncertainMessage, 0, true);
  }
  return data;
}