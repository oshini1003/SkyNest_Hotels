import { API_BASE, clearSession, readSession } from "./session";

const expiryMessage = "Your session has expired. Please sign in again.";
const uncertainMessage = "We could not confirm the result. Check the booking list before trying again; the request may already have been saved.";
const rejections = {
  400: "Check the details and try again.",
  401: expiryMessage,
  403: "Your account cannot do this. Front-desk staff may only book rooms at their own branch.",
  404: "The guest or room could not be found.",
  409: "The room or guest details conflict with an existing record.",
  422: "These details could not be accepted.",
  429: "Too many requests. Please wait before trying again.",
};

function failure(message, status = 0, outcomeUnknown = false) {
  return Object.assign(new Error(message), { status, outcomeUnknown });
}

function cancelled(outcomeUnknown = false) {
  return Object.assign(new DOMException("Request cancelled or session changed", "AbortError"), { outcomeUnknown });
}

export function isCurrentStaff(token) {
  return Boolean(token) && readSession("staff")?.token === token;
}

async function request(path, { token, signal, method = "GET", body } = {}) {
  if (!isCurrentStaff(token)) throw failure(expiryMessage, 401);
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
      redirect: "error",
      signal: controller.signal,
    });
    data = await response.json().catch(() => null);
  } catch {
    if (signal?.aborted || !isCurrentStaff(token)) throw cancelled(mutation);
    throw failure(mutation ? uncertainMessage : "The service is unavailable. Please try again.", 0, mutation);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
  if (signal?.aborted || !isCurrentStaff(token)) throw cancelled(mutation);
  if (controller.signal.aborted) throw failure(mutation ? uncertainMessage : "The service took too long to respond.", 0, mutation);
  if (response.status === 401) {
    try { clearSession("staff", expiryMessage); } catch { /* keep the HTTP outcome */ }
    throw failure(expiryMessage, 401);
  }
  if (!response.ok) {
    const known = rejections[response.status];
    const serverText = [400, 409, 422].includes(response.status) && typeof data?.error === "string" ? data.error : "";
    const unknown = mutation && !known;
    throw failure(unknown ? uncertainMessage : serverText || known || "Unable to load results. Please try again.", response.status, unknown);
  }
  if (!data) throw failure(mutation ? uncertainMessage : "The service returned an unexpected response.", response.status, mutation);
  return data;
}

export async function searchGuests(term, token, signal) {
  const data = await request(`/guests?q=${encodeURIComponent(term)}`, { token, signal });
  if (!Array.isArray(data) || data.some((guest) => !Number.isSafeInteger(guest.GuestID))) {
    throw failure("The service returned an unexpected response.");
  }
  return data;
}

export async function createGuest(details, token, signal) {
  const data = await request("/guests", { method: "POST", body: details, token, signal });
  if (!Number.isSafeInteger(data.guest?.GuestID)) throw failure(uncertainMessage, 0, true);
  return data.guest;
}

export async function createStaffBooking(details, token, signal) {
  const data = await request("/bookings", { method: "POST", body: details, token, signal });
  if (!Number.isSafeInteger(data.bookingId) || data.bookingId < 1 || data.status !== "Booked") {
    throw failure(uncertainMessage, 0, true);
  }
  return data;
}