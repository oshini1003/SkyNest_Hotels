import { API_BASE, clearSession } from "./session";
import { isCurrentStaff, staffBookingId } from "./staffBookingApi";

const expiryMessage = "Your staff session has expired. Please sign in again.";
const unexpectedMessage = "The service history could not be read. Please refresh the history and bill.";
const uncertainMessage = "We could not confirm whether the service entry was saved. Refresh the history and bill, then check for this entry before recording it again.";

function failure(message, status = 0, outcomeUnknown = false) {
  return Object.assign(new Error(message), { status, outcomeUnknown });
}

export function canRecordServiceUsage(role) {
  return ["Admin", "Manager", "Receptionist", "ServiceStaff"].includes(role);
}

export function serviceQuantity(value) {
  return staffBookingId(value);
}

async function request(path, token, signal, entry) {
  if (!isCurrentStaff(token)) throw failure(expiryMessage, 401);
  if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 10000);
  const mutation = entry !== undefined;
  let response;
  let data;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: mutation ? "POST" : "GET",
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      ...(mutation ? { body: JSON.stringify(entry) } : {}),
      cache: "no-store",
      signal: controller.signal,
    });
    data = await response.json().catch(() => null);
  } catch {
    if (signal?.aborted || !isCurrentStaff(token)) throw new DOMException("Request cancelled", "AbortError");
    throw failure(mutation ? uncertainMessage : "The service history is unavailable. Please try again.", 0, mutation);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
  // An old request must neither display another session's data nor sign it out.
  if (signal?.aborted || !isCurrentStaff(token)) throw new DOMException("Session changed", "AbortError");
  if (response.status === 401) {
    clearSession("staff", expiryMessage);
    throw failure(expiryMessage, 401);
  }
  if (!response.ok) {
    const unknown = mutation && response.status >= 500;
    throw failure(unknown ? uncertainMessage : (typeof data?.error === "string" ? data.error : "Unable to complete this request."), response.status, unknown);
  }
  if (!data || (mutation && response.status !== 201)) {
    throw failure(mutation ? uncertainMessage : unexpectedMessage, response.status, mutation);
  }
  return data;
}

function validAmount(value, allowNegative = false) {
  return (typeof value === "number" || (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value))) &&
    Number.isFinite(Number(value)) && (allowNegative || Number(value) >= 0);
}

export async function loadServiceBill(id, token, signal) {
  const bookingId = staffBookingId(id);
  if (bookingId === null) throw failure("Enter a valid booking reference.", 400);
  const data = await request(`/bookings/${bookingId}/bill`, token, signal);
  const bill = data.bill;
  const validBill = bill === null || (bill && staffBookingId(bill.BillID) !== null &&
    Number(bill.BookingID) === bookingId && typeof bill.BillStatus === "string" &&
    [bill.RoomCharges, bill.ServiceCharges, bill.TotalAmount].every((value) => validAmount(value)));
  const validUsage = Array.isArray(data.serviceUsage) && data.serviceUsage.every((usage) => usage &&
    staffBookingId(usage.UsageID) !== null && Number(usage.BookingID) === bookingId &&
    staffBookingId(usage.ServiceID) !== null && serviceQuantity(usage.Quantity) !== null &&
    typeof usage.ServiceName === "string" && typeof usage.UsageDateDisplay === "string" &&
    usage.UsageDateDisplay.trim() !== "" && validAmount(usage.PriceAtUsage) && validAmount(usage.LineTotal));
  if (Number(data.bookingId) !== bookingId || !validBill || !validUsage ||
      !Array.isArray(data.payments) || ![data.roomCharges, data.serviceCharges, data.totalAmount].every((value) => validAmount(value)) ||
      !validAmount(data.outstandingBalance, true)) throw failure(unexpectedMessage);
  return data;
}

export async function saveServiceUsage(entry, token, signal) {
  const bookingId = staffBookingId(entry?.bookingId);
  const serviceId = staffBookingId(entry?.serviceId);
  const quantity = serviceQuantity(entry?.quantity);
  if (bookingId === null || serviceId === null || quantity === null) {
    throw failure("Choose a service and enter a whole-number quantity from 1 to 2147483647.", 400);
  }
  const data = await request("/service-usage", token, signal, { bookingId, serviceId, quantity });
  if (data.bookingId !== bookingId || data.serviceId !== serviceId || data.quantity !== quantity) {
    throw failure(uncertainMessage, 0, true);
  }
  return data;
}
