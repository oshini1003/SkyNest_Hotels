import { API_BASE, clearSession, readSession } from "./session";
import { guestBillId } from "./guestBillingApi";

const expiryMessage = "Your session has expired. Please sign in again.";
const uncertainMessage = "We could not confirm whether this service was saved. Refresh your bill and check with the hotel before submitting another request.";
const catalogueMessage = "The service catalogue is unavailable. Please refresh and try again.";
const maximumCents = 9999999999n;
const inFlight = new Set();

function failure(message, status = 0, outcomeUnknown = false) {
  return Object.assign(new Error(message), { status, outcomeUnknown });
}

function cancelled(outcomeUnknown = false) {
  return Object.assign(new DOMException("Request cancelled or session changed", "AbortError"), { outcomeUnknown });
}

function currentGuest(token, guestId) {
  const session = readSession("guest");
  const id = guestBillId(session?.guest?.guestId);
  return typeof token === "string" && token && session?.token === token && id !== null &&
    (guestId === undefined || guestId === id) ? id : null;
}

function cents(value) {
  if (!["string", "number"].includes(typeof value)) return null;
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match || match[1].length > 8) return null;
  const amount = BigInt(match[1]) * 100n + BigInt((match[2] || "").padEnd(2, "0"));
  return amount <= maximumCents ? amount : null;
}

function decimal(amount) {
  return `${amount / 100n}.${String(amount % 100n).padStart(2, "0")}`;
}

export function guestServiceTotal(unitPrice, quantity) {
  const price = cents(unitPrice);
  const count = guestBillId(quantity);
  if (price === null || count === null) return null;
  const total = price * BigInt(count);
  return total <= maximumCents ? decimal(total) : null;
}

function attemptKey(guestId, bookingId) {
  const guest = guestBillId(guestId);
  const booking = guestBillId(bookingId);
  if (guest === null || booking === null) throw failure("Sign in and open a valid booking before requesting a service.", 400);
  return `skynest_guest_service_attempt:${guest}:${booking}`;
}

function validAttempt(value, guestId, bookingId) {
  const fields = ["guestId", "bookingId", "serviceId", "quantity", "stage"];
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === fields.length && Object.keys(value).every((field) => fields.includes(field)) &&
    value.guestId === Number(guestId) && value.bookingId === Number(bookingId) &&
    guestBillId(value.serviceId) !== null && guestBillId(value.serviceId) === value.serviceId &&
    guestBillId(value.quantity) !== null && guestBillId(value.quantity) === value.quantity &&
    ["pending", "saved"].includes(value.stage);
}

export function readGuestServiceAttempt(guestId, bookingId) {
  const key = attemptKey(guestId, bookingId);
  let raw;
  try { raw = sessionStorage.getItem(key); } catch {
    throw failure("Your browser could not read the saved service request. Check browser storage and ask the hotel to check your bill before continuing.");
  }
  if (raw === null) return null;
  let attempt;
  try { attempt = JSON.parse(raw); } catch { /* Unreadable records block another POST. */ }
  if (!validAttempt(attempt, guestId, bookingId)) {
    throw failure("A saved service request could not be verified. Check your bill with the hotel before clearing this request.");
  }
  return attempt;
}

export function clearGuestServiceAttempt(guestId, bookingId) {
  const key = attemptKey(guestId, bookingId);
  if (inFlight.has(key)) throw failure("Please wait for the current service request to finish.");
  try { sessionStorage.removeItem(key); } catch {
    throw failure("Your browser could not clear the saved service request. Check browser storage before continuing.");
  }
}

function saveAttempt(key, attempt) {
  sessionStorage.setItem(key, JSON.stringify(attempt));
  // A silently discarded write cannot protect against a repeat after reloading.
  if (sessionStorage.getItem(key) !== JSON.stringify(attempt)) throw new Error("Storage write could not be verified.");
}

function safeExpiry() {
  // A failed notice write must never replace the HTTP outcome with a storage error.
  try { clearSession("guest", expiryMessage); } catch { /* UI still receives 401. */ }
}

function services(data) {
  if (!Array.isArray(data)) return null;
  const seen = new Set();
  const active = [];
  for (const item of data) {
    const id = guestBillId(item?.ServiceID);
    const price = cents(item?.UnitPrice);
    if (!item || typeof item !== "object" || Array.isArray(item) || id === null || seen.has(id) ||
        typeof item.ServiceName !== "string" || !item.ServiceName.trim() ||
        !(item.Description === null || typeof item.Description === "string") ||
        price === null || ![true, false, 0, 1].includes(item.IsActive)) return null;
    seen.add(id);
    if (item.IsActive === true || item.IsActive === 1) active.push({ ...item, ServiceID: id, UnitPrice: decimal(price) });
  }
  return active;
}

export async function loadGuestServiceCatalogue(token, signal) {
  const guestId = currentGuest(token);
  if (guestId === null) throw failure(expiryMessage, 401);
  if (signal?.aborted) throw cancelled();
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 10000);
  let response;
  let data;
  try {
    response = await fetch(`${API_BASE}/services`, {
      method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      cache: "no-store", signal: controller.signal,
    });
    data = await response.json().catch(() => null);
  } catch {
    if (signal?.aborted || currentGuest(token, guestId) === null) throw cancelled();
    throw failure(controller.signal.aborted ? "The service catalogue took too long to respond. Please refresh." : catalogueMessage);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
  if (signal?.aborted || currentGuest(token, guestId) === null) throw cancelled();
  if (controller.signal.aborted) throw failure("The service catalogue took too long to respond. Please refresh.");
  if (response.status === 401) { safeExpiry(); throw failure(expiryMessage, 401); }
  if (response.status !== 200 || !response.ok) throw failure(catalogueMessage, response.status);
  const result = services(data);
  if (result === null) throw failure("The service catalogue could not be verified. Please refresh or contact the hotel.", response.status);
  return result;
}

export async function requestGuestService(entry, token, signal) {
  const bookingId = guestBillId(entry?.bookingId);
  const serviceId = guestBillId(entry?.serviceId);
  const quantity = guestBillId(entry?.quantity);
  if (bookingId === null || serviceId === null || quantity === null) {
    throw failure("Choose a service and enter a whole-number quantity from 1 to 2147483647.", 400);
  }
  const guestId = currentGuest(token);
  if (guestId === null) throw failure(expiryMessage, 401);
  if (signal?.aborted) throw cancelled();
  const key = attemptKey(guestId, bookingId);
  if (inFlight.has(key) || readGuestServiceAttempt(guestId, bookingId)) {
    throw failure("Check the previous service request against your refreshed bill before submitting another request.", 0, true);
  }
  const attempt = { guestId, bookingId, serviceId, quantity, stage: "pending" };
  try { saveAttempt(key, attempt); } catch {
    throw failure("Your browser could not save this request for checking later. No request was sent. Allow session storage before continuing.");
  }
  inFlight.add(key);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 10000);
  let response;
  let data;
  try {
    try {
      // This is one POST, without retries. The server owns guest identity and price.
      response = await fetch(`${API_BASE}/service-usage`, {
        method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ bookingId, serviceId, quantity }), cache: "no-store", signal: controller.signal,
      });
      data = await response.json().catch(() => null);
    } catch {
      if (signal?.aborted || currentGuest(token, guestId) === null) throw cancelled(true);
      throw failure(uncertainMessage, 0, true);
    }
    // Even a successful late response may belong to a previous sign-in. Keep its marker.
    if (signal?.aborted || currentGuest(token, guestId) === null) throw cancelled(true);
    if (controller.signal.aborted) throw failure(uncertainMessage, 0, true);
    if (response.status === 201 && response.ok && data && typeof data === "object" && !Array.isArray(data) &&
        data.bookingId === bookingId && data.serviceId === serviceId && data.quantity === quantity) {
      try { saveAttempt(key, { ...attempt, stage: "saved" }); } catch {
        throw Object.assign(failure("Your service was saved, but this browser could not update its request record. Refresh your bill before continuing.", 201), { saved: true });
      }
      return { bookingId, serviceId, quantity, saved: true };
    }
    const rejections = {
      400: "Check the service and quantity. The request was not saved.",
      401: expiryMessage,
      403: "Your guest account cannot request this service.",
      404: "This booking or service could not be found.",
      409: "The booking or service changed. Refresh your bill and service list before trying again.",
      422: "The service request was not accepted. Review the service and quantity.",
      429: "Too many requests. Please wait before trying again.",
    };
    if (!response.ok && rejections[response.status]) {
      // A definitive rejection can release the marker; an unknown 4xx (e.g. 408) cannot.
      try { sessionStorage.removeItem(key); } catch { /* Preserve the marker if storage is unavailable. */ }
      if (response.status === 401) safeExpiry();
      throw failure(rejections[response.status], response.status);
    }
    throw failure(uncertainMessage, response.status, true);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    inFlight.delete(key);
  }
}
