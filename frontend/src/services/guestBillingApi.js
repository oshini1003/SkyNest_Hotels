import { API_BASE, clearSession, readSession } from "./session";

const expiryMessage = "Your session has expired. Please sign in again.";
const unexpectedMessage = "Your bill and history could not be verified. Please refresh or contact the hotel.";
const timeoutMessage = "The bill request took too long. Please try again.";
const unavailableMessage = "The billing service is unavailable. Please try again.";
const bookingStatuses = ["Booked", "Checked-In", "Checked-Out", "Cancelled"];
const billStatuses = ["Unpaid", "Partially Paid", "Paid"];
// Every saved monetary column, and both estimate functions, use DECIMAL(10,2).
const maximumSavedCents = 9999999999n;

function failure(message, status = 0) {
  return Object.assign(new Error(message), { status });
}

function record(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function guestBillId(value) {
  if (!["string", "number"].includes(typeof value) || !/^[1-9]\d*$/.test(String(value))) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id <= 2147483647 ? id : null;
}

// Decimal strings remain exact; no parseFloat, binary addition or rounding.
function cents(value, allowNegative = false) {
  if (!["string", "number"].includes(typeof value)) return null;
  if (typeof value === "number" && (!Number.isFinite(value) || Math.abs(value) > 99999999.99)) return null;
  const match = /^(-?)(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match || match[2].length > 32 || (match[1] && !allowNegative)) return null;
  const absolute = BigInt(match[2]) * 100n + BigInt((match[3] || "").padEnd(2, "0"));
  return match[1] ? -absolute : absolute;
}

function savedCents(value, allowNegative = false) {
  const amount = cents(value, allowNegative);
  return amount !== null && amount <= maximumSavedCents && amount >= -maximumSavedCents ? amount : null;
}

export function formatBillMoney(value) {
  const amount = cents(value, true);
  if (amount === null) return "Unavailable";
  const absolute = amount < 0n ? -amount : amount;
  return `LKR ${amount < 0n ? "-" : ""}${(absolute / 100n).toLocaleString("en-LK")}.${String(absolute % 100n).padStart(2, "0")}`;
}

function validServerDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return false;
  const date = new Date(`${value.replace(" ", "T")}Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 19).replace("T", " ") === value;
}

function currentGuest(token) {
  const session = readSession("guest");
  return typeof token === "string" && Boolean(token) && session?.token === token &&
    guestBillId(session?.guest?.guestId) !== null;
}

function verifiedBill(data, bookingId) {
  if (!record(data) || guestBillId(data.bookingId) !== bookingId || !bookingStatuses.includes(data.bookingStatus) ||
      !Array.isArray(data.payments) || !Array.isArray(data.serviceUsage)) return false;

  const totals = [data.roomCharges, data.serviceCharges, data.totalAmount, data.paidAmount].map((value) => savedCents(value));
  const outstanding = savedCents(data.outstandingBalance, true);
  if (totals.includes(null) || outstanding === null) return false;
  const [room, services, total, paid] = totals;
  if (room + services !== total || total - paid !== outstanding) return false;

  const bill = data.bill;
  if (bill === null) {
    // Before check-in the API returns an estimate, including for cancelled stays.
    return ["Booked", "Cancelled"].includes(data.bookingStatus) && services === 0n && paid === 0n &&
      data.payments.length === 0 && data.serviceUsage.length === 0;
  }
  if (!record(bill) || guestBillId(bill.BillID) === null || guestBillId(bill.BookingID) !== bookingId ||
      !billStatuses.includes(bill.BillStatus) ||
      !(bill.StaffID === null || guestBillId(bill.StaffID) !== null) ||
      !["Checked-In", "Checked-Out"].includes(data.bookingStatus) ||
      [bill.RoomCharges, bill.ServiceCharges, bill.TotalAmount].some((value, index) => savedCents(value) !== totals[index])) return false;

  const expectedStatus = paid >= total ? "Paid" : paid > 0n ? "Partially Paid" : "Unpaid";
  // Check-in initially opens an Unpaid bill, even if its total happens to be zero.
  const newlyOpenedFreeStay = data.bookingStatus === "Checked-In" && total === 0n && paid === 0n && bill.BillStatus === "Unpaid";
  if (bill.BillStatus !== expectedStatus && !newlyOpenedFreeStay) return false;
  if (data.bookingStatus === "Checked-Out" && (outstanding > 0n || guestBillId(bill.StaffID) === null)) return false;

  const paymentIds = new Set();
  let paymentTotal = 0n;
  for (const payment of data.payments) {
    if (!record(payment)) return false;
    const id = guestBillId(payment.PaymentID);
    const amount = savedCents(payment.Amount);
    if (id === null || paymentIds.has(id) || guestBillId(payment.BookingID) !== bookingId ||
        guestBillId(payment.BillID) !== guestBillId(bill.BillID) || amount === null || amount <= 0n ||
        !["Full", "Partial"].includes(payment.PaymentType) ||
        !["Cash", "Card", "Bank Transfer"].includes(payment.PaymentMethod) || !validServerDate(payment.PaymentDateDisplay)) return false;
    paymentIds.add(id);
    paymentTotal += amount;
  }
  if (paymentTotal !== paid) return false;

  const usageIds = new Set();
  let serviceTotal = 0n;
  for (const usage of data.serviceUsage) {
    if (!record(usage)) return false;
    const id = guestBillId(usage.UsageID);
    const quantity = guestBillId(usage.Quantity);
    const price = savedCents(usage.PriceAtUsage);
    const line = savedCents(usage.LineTotal);
    if (id === null || usageIds.has(id) || guestBillId(usage.BookingID) !== bookingId ||
        guestBillId(usage.ServiceID) === null || quantity === null || price === null || line === null ||
        typeof usage.ServiceName !== "string" || !usage.ServiceName.trim() ||
        !validServerDate(usage.UsageDateDisplay) || price * BigInt(quantity) !== line) return false;
    usageIds.add(id);
    serviceTotal += line;
  }
  return serviceTotal === services;
}

export async function loadGuestBill(id, token, signal) {
  const bookingId = guestBillId(id);
  if (bookingId === null) throw failure("Enter a valid booking reference.", 400);
  if (!currentGuest(token)) throw failure(expiryMessage, 401);
  if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError");

  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 10000);
  let response;
  let data;
  try {
    // One read-only endpoint keeps charges, payments and services in one snapshot.
    response = await fetch(`${API_BASE}/bookings/${bookingId}/bill`, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: controller.signal,
    });
    data = await response.json().catch(() => null);
  } catch {
    if (signal?.aborted || !currentGuest(token)) throw new DOMException("Request cancelled", "AbortError");
    throw failure(controller.signal.aborted ? timeoutMessage : unavailableMessage);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }

  // A delayed response must neither reveal a previous guest's bill nor sign out a new guest.
  if (signal?.aborted || !currentGuest(token)) throw new DOMException("Session changed", "AbortError");
  if (controller.signal.aborted) throw failure(timeoutMessage);
  if (response.status === 401) {
    clearSession("guest", expiryMessage);
    throw failure(expiryMessage, 401);
  }
  if (!response.ok) {
    const messages = {
      400: "Enter a valid booking reference.",
      403: "Your guest account cannot access this bill.",
      404: "This booking could not be found.",
      429: "Too many requests. Please wait a moment and try again.",
    };
    throw failure(messages[response.status] || unavailableMessage, response.status);
  }
  if (response.status !== 200 || !verifiedBill(data, bookingId)) throw failure(unexpectedMessage, response.status);
  return data;
}
