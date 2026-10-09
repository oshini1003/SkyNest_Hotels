import { API_BASE, clearSession, readSession } from "./session";

const expiryMessage = "Your session has expired. Please sign in again.";
const uncertainMessage = "We could not confirm the result. Check My bookings before trying again; the request may already have been saved.";
const changesInFlight = new Set();
const acknowledgedChanges = new Map();
const rejections = {
  400: "Check the booking details and try again.",
  401: expiryMessage,
  403: "Your account cannot make this booking change.",
  404: "This booking or room could not be found. Refresh your bookings.",
  409: "The booking or room changed. Refresh your bookings before trying again.",
  422: "These booking details could not be accepted.",
  429: "Too many requests. Please wait before trying again.",
};

function failure(message, status = 0, outcomeUnknown = false) {
  return Object.assign(new Error(message), { status, outcomeUnknown });
}

function cancelled(outcomeUnknown = false) {
  return Object.assign(new DOMException("Request cancelled or session changed", "AbortError"), { outcomeUnknown });
}

function positiveId(value) {
  if (typeof value !== "number" && !(typeof value === "string" && /^[1-9]\d*$/.test(value))) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id >= 1 && id <= 2147483647 ? id : null;
}

function changeIdentity(bookingId, token) {
  const id = positiveId(bookingId);
  if (id === null) throw failure("Open a valid booking before changing it.", 400);
  const session = readSession("guest");
  const guestId = positiveId(session?.guest?.guestId);
  if (!token || session?.token !== token || guestId === null) throw failure(expiryMessage, 401);
  return { guestId, bookingId: id, key: `skynest_guest_booking_change:${guestId}:${id}` };
}

function validChange(value, guestId, bookingId) {
  const fields = ["guestId", "bookingId", "kind", "action", ...(value?.action === "update" ? ["bookedRoomId"] : [])];
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === fields.length && Object.keys(value).every((field) => fields.includes(field)) &&
    value.guestId === guestId && value.bookingId === bookingId && ["pending", "unknown", "saved"].includes(value.kind) &&
    ["update", "cancel"].includes(value.action) &&
    (value.action !== "update" || (positiveId(value.bookedRoomId) !== null && value.bookedRoomId === positiveId(value.bookedRoomId)));
}

// This is a per-tab reconciliation guard, not server-side idempotency. No tokens
// or guest contact information are saved. Another sign-in by this guest retains it.
export function readGuestBookingChange(bookingId, token) {
  const { key, guestId, bookingId: id } = changeIdentity(bookingId, token);
  if (acknowledgedChanges.has(key)) return { ...acknowledgedChanges.get(key) };
  let raw;
  try { raw = sessionStorage.getItem(key); } catch {
    throw failure("Your browser could not read the previous booking change. Check browser storage before continuing.");
  }
  if (raw === null) return null;
  let change;
  try { change = JSON.parse(raw); } catch { /* Unreadable records block writes. */ }
  if (!validChange(change, guestId, id)) throw failure("A previous booking change could not be verified. Check the current details with the hotel before continuing.");
  return { ...change, kind: change.kind === "pending" && !changesInFlight.has(key) ? "unknown" : change.kind };
}

export function acknowledgeGuestBookingChange(bookingId, token) {
  const { key } = changeIdentity(bookingId, token);
  if (changesInFlight.has(key)) throw failure("Please wait for the current booking change to finish.");
  try {
    sessionStorage.removeItem(key);
    if (sessionStorage.getItem(key) !== null) throw new Error("Removal could not be verified.");
  } catch {
    throw failure("Your browser could not clear the previous booking change. Check browser storage before continuing.");
  }
  acknowledgedChanges.delete(key);
}

function persistChange(key, value) {
  const raw = JSON.stringify(value);
  sessionStorage.setItem(key, raw);
  if (sessionStorage.getItem(key) !== raw) throw new Error("Storage write could not be verified.");
}

export function isCurrentGuest(token) {
  return Boolean(token) && readSession("guest")?.token === token;
}

async function request(path, { token, signal, method = "GET", body, expectedStatus } = {}) {
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
      redirect: "error",
      signal: controller.signal,
    });
    data = await response.json().catch(() => null);
  } catch {
    if (signal?.aborted || !isCurrentGuest(token)) throw cancelled(mutation);
    throw failure(mutation ? uncertainMessage : "The booking service is unavailable. Please try again.", 0, mutation);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
  // Neither return another guest's data nor let an old 401 clear a new sign-in.
  if (signal?.aborted || !isCurrentGuest(token)) throw cancelled(mutation);
  if (controller.signal.aborted) throw failure(mutation ? uncertainMessage : "The booking service took too long to respond.", 0, mutation);
  if (response.status === 401) {
    try { clearSession("guest", expiryMessage); } catch { /* Preserve the HTTP outcome if storage fails. */ }
    throw failure(expiryMessage, 401);
  }
  if (!response.ok) {
    const unknown = mutation && !rejections[response.status];
    throw failure(unknown ? uncertainMessage : mutation ? rejections[response.status] : "Unable to load your booking details. Please refresh.", response.status, unknown);
  }
  if (expectedStatus !== undefined && response.status !== expectedStatus) throw failure(uncertainMessage, response.status, mutation);
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

function updateDraft(changes) {
  const allowed = ["bookedRoomId", "roomId", "checkin", "checkout", "guestCount"];
  if (!changes || typeof changes !== "object" || Array.isArray(changes) ||
      Object.keys(changes).some((key) => !allowed.includes(key)) || Object.keys(changes).length < 2) {
    throw failure("Choose one booked room and change its dates, room or guest count.", 400);
  }
  const draft = {};
  for (const key of ["bookedRoomId", "roomId", "guestCount"]) {
    if (key !== "bookedRoomId" && !Object.hasOwn(changes, key)) continue;
    const value = positiveId(changes[key]);
    if (value === null) throw failure("Room references and guest counts must be positive whole numbers.", 400);
    draft[key] = value;
  }
  for (const key of ["checkin", "checkout"]) {
    if (!Object.hasOwn(changes, key)) continue;
    const value = changes[key];
    const day = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(`${value}T00:00:00Z`) : NaN;
    if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== value) throw failure("Choose valid stay dates.", 400);
    draft[key] = value;
  }
  if (draft.checkin && draft.checkout && draft.checkout <= draft.checkin) throw failure("Check-out must be after check-in.", 400);
  return draft;
}

async function changeBooking(bookingId, action, body, token, signal) {
  const { key, guestId, bookingId: id } = changeIdentity(bookingId, token);
  if (signal?.aborted) throw cancelled();
  if (changesInFlight.has(key) || readGuestBookingChange(id, token)) {
    throw failure("Check the previous booking change against the refreshed details before making another change.", 0, true);
  }
  const marker = { guestId, bookingId: id, kind: "pending", action, ...(body ? { bookedRoomId: body.bookedRoomId } : {}) };
  try { persistChange(key, marker); } catch {
    throw failure("Your browser could not save this booking change for checking later. No request was sent. Allow session storage before continuing.");
  }
  changesInFlight.add(key);
  try {
    const data = await request(`/bookings/${id}${action === "cancel" ? "/cancel" : ""}`, { method: "PATCH", body, token, signal, expectedStatus: 200 });
    if (!data || typeof data !== "object" || Array.isArray(data) || data.bookingId !== id ||
        (action === "cancel" ? data.status !== "Cancelled" : data.updated !== true || data.status !== "Booked" || data.bookedRoomId !== body.bookedRoomId)) {
      throw failure(uncertainMessage, 0, true);
    }
    const saved = { ...marker, kind: "saved" };
    // A confirmed save normally releases the guard. Cleanup failures cannot turn
    // known success into an uncertain result; retain a saved marker for checking.
    acknowledgedChanges.set(key, saved);
    try {
      sessionStorage.removeItem(key);
      if (sessionStorage.getItem(key) !== null) throw new Error("Removal could not be verified.");
      acknowledgedChanges.delete(key);
    } catch {
      try { persistChange(key, saved); } catch { /* Keep known success in memory. */ }
    }
    return data;
  } catch (error) {
    if (error.outcomeUnknown || error.name === "AbortError") {
      try { persistChange(key, { ...marker, kind: "unknown" }); } catch { /* Pending still blocks repeats. */ }
    } else {
      try { sessionStorage.removeItem(key); } catch { /* A failed removal remains blocked until reconciliation. */ }
    }
    throw error;
  } finally {
    changesInFlight.delete(key);
  }
}

// Only explicitly changed fields are sent: omitted dates retain their current
// stored values when the existing procedure acquires its booking lock.
export async function updateGuestBooking(bookingId, changes, token, signal) {
  return changeBooking(bookingId, "update", updateDraft(changes), token, signal);
}

export async function cancelGuestBooking(bookingId, token, signal) {
  return changeBooking(bookingId, "cancel", undefined, token, signal);
}
