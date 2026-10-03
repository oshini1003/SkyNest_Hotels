import { API_BASE, clearSession } from "./session";
import { bookingStatuses, isCurrentStaff, staffBookingId } from "./staffBookingApi";

export const paymentMethods = ["Cash", "Card", "Bank Transfer"];
const billStatuses = ["Unpaid", "Partially Paid", "Paid"];
const expiryMessage = "Your staff session has expired. Please sign in again.";
const unexpectedMessage = "The bill and payment history could not be verified. Refresh them before continuing.";
const uncertainMessage = "The result could not be confirmed. Refresh the bill and history, then reconcile this action with hotel records before continuing.";

function failure(message, status = 0, outcomeUnknown = false) {
  return Object.assign(new Error(message), { status, outcomeUnknown });
}

export function canManageBilling(role) {
  return ["Admin", "Manager", "Receptionist"].includes(role);
}

// Parse decimal money as whole cents; never round user input into a payment.
export function moneyCents(value, allowNegative = false) {
  if (!["string", "number"].includes(typeof value)) return null;
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match || (match[1] && !allowNegative) || match[2].length > 16) return null;
  const absolute = BigInt(match[2]) * 100n + BigInt((match[3] || "").padEnd(2, "0"));
  if (absolute > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(match[1] ? -absolute : absolute);
}

export function paymentAmount(value) {
  if (typeof value !== "string") return null;
  const cents = moneyCents(value.trim());
  if (cents === null || cents < 1 || cents > 9999999999) return null;
  return { cents, amount: `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}` };
}

function validServerDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return false;
  const date = new Date(`${value.replace(" ", "T")}Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 19).replace("T", " ") === value;
}

function validBill(bill, bookingId) {
  return bill === null || (bill && staffBookingId(bill.BillID) !== null &&
    staffBookingId(bill.BookingID) === bookingId && billStatuses.includes(bill.BillStatus) &&
    [bill.RoomCharges, bill.ServiceCharges, bill.TotalAmount].every((value) => moneyCents(value) !== null));
}

async function request(path, token, signal, entry, successStatus = 200) {
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
    throw failure(mutation ? uncertainMessage : "The billing service is unavailable. Refresh the bill and payment history.", 0, mutation);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
  // A response for an old staff session must not reveal data or clear a new one.
  if (signal?.aborted || !isCurrentStaff(token)) throw new DOMException("Session changed", "AbortError");
  if (response.status === 401) {
    clearSession("staff", expiryMessage);
    throw failure(expiryMessage, 401);
  }
  if (!response.ok) {
    const unknown = mutation && response.status >= 500;
    throw failure(unknown ? uncertainMessage : (typeof data?.error === "string" ? data.error : "Unable to complete this request."), response.status, unknown);
  }
  if (!data || response.status !== successStatus) throw failure(mutation ? uncertainMessage : unexpectedMessage, response.status, mutation);
  return data;
}

export async function loadStaffBill(id, token, signal) {
  const bookingId = staffBookingId(id);
  if (bookingId === null) throw failure("Enter a valid booking reference.", 400);
  const data = await request(`/bookings/${bookingId}/bill`, token, signal);
  const bill = data.bill;
  const validPayments = Array.isArray(data.payments) && data.payments.every((payment) => payment &&
    staffBookingId(payment.PaymentID) !== null && staffBookingId(payment.BookingID) === bookingId &&
    bill && staffBookingId(payment.BillID) === staffBookingId(bill.BillID) &&
    ["Full", "Partial"].includes(payment.PaymentType) && paymentMethods.includes(payment.PaymentMethod) &&
    moneyCents(payment.Amount) !== null && moneyCents(payment.Amount) > 0 && validServerDate(payment.PaymentDateDisplay));
  const validUsage = Array.isArray(data.serviceUsage) && data.serviceUsage.every((usage) => usage &&
    staffBookingId(usage.UsageID) !== null && staffBookingId(usage.BookingID) === bookingId &&
    staffBookingId(usage.ServiceID) !== null && staffBookingId(usage.Quantity) !== null &&
    typeof usage.ServiceName === "string" && validServerDate(usage.UsageDateDisplay) &&
    moneyCents(usage.PriceAtUsage) !== null && moneyCents(usage.LineTotal) !== null);
  const totals = [data.roomCharges, data.serviceCharges, data.totalAmount, data.paidAmount].map((value) => moneyCents(value));
  const outstanding = moneyCents(data.outstandingBalance, true);
  if (staffBookingId(data.bookingId) !== bookingId || !bookingStatuses.includes(data.bookingStatus) ||
      !validBill(bill, bookingId) || !validPayments || !validUsage || totals.includes(null) || outstanding === null) {
    throw failure(unexpectedMessage);
  }
  const paymentIds = data.payments.map((payment) => Number(payment.PaymentID));
  const paid = data.payments.reduce((sum, payment) => sum + moneyCents(payment.Amount), 0);
  if (!Number.isSafeInteger(paid) || paid !== totals[3] || totals[2] - totals[3] !== outstanding ||
      new Set(paymentIds).size !== paymentIds.length ||
      (bill && [bill.RoomCharges, bill.ServiceCharges, bill.TotalAmount].some((value, index) => moneyCents(value) !== totals[index]))) {
    throw failure(unexpectedMessage);
  }
  return data;
}

export async function recordStaffPayment(entry, token, signal) {
  const bookingId = staffBookingId(entry?.bookingId);
  const parsed = paymentAmount(entry?.amount);
  if (bookingId === null || !parsed || !paymentMethods.includes(entry?.paymentMethod)) {
    throw failure("Enter an amount from 0.01 to 99999999.99 with at most two decimal places and choose Cash, Card or Bank Transfer.", 400);
  }
  const data = await request("/payments", token, signal, { bookingId, amount: parsed.amount, paymentMethod: entry.paymentMethod }, 201);
  if (staffBookingId(data.bookingId) !== bookingId || moneyCents(data.amount) !== parsed.cents ||
      !(data.outstandingBalance === null || moneyCents(data.outstandingBalance, true) !== null) ||
      !(data.refreshRequired === undefined || data.refreshRequired === true) ||
      (data.outstandingBalance === null && data.refreshRequired !== true)) throw failure(uncertainMessage, 201, true);
  return data;
}

export async function checkOutStaffBooking(id, token, signal) {
  const bookingId = staffBookingId(id);
  if (bookingId === null) throw failure("Enter a valid booking reference.", 400);
  const data = await request(`/bookings/${bookingId}/check-out`, token, signal, {});
  if (staffBookingId(data.bookingId) !== bookingId || data.status !== "Checked-Out" || !validBill(data.bill, bookingId) ||
      !(data.refreshRequired === undefined || data.refreshRequired === true)) throw failure(uncertainMessage, 200, true);
  return data;
}
