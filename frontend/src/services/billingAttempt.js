import { paymentAmount, paymentMethods } from "./billingApi";
import { staffBookingId } from "./staffBookingApi";

function key(staffId, bookingId) {
  if (staffBookingId(staffId) === null || staffBookingId(bookingId) === null) {
    throw new Error("The staff account or booking could not be verified. Sign in again before recording a billing action.");
  }
  return `skynest_billing_attempt:${Number(staffId)}:${Number(bookingId)}`;
}

function validAttempt(value, staffId, bookingId) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      value.staffId !== Number(staffId) || value.bookingId !== Number(bookingId)) return false;
  const fields = value.kind === "payment"
    ? ["kind", "staffId", "bookingId", "amount", "paymentMethod"] : ["kind", "staffId", "bookingId"];
  if (Object.keys(value).length !== fields.length || Object.keys(value).some((field) => !fields.includes(field))) return false;
  if (value.kind === "checkout") return true;
  const parsedAmount = paymentAmount(value.amount);
  return value.kind === "payment" && Boolean(parsedAmount) && parsedAmount.amount === value.amount && paymentMethods.includes(value.paymentMethod);
}

export function readBillingAttempt(staffId, bookingId) {
  let raw;
  try {
    raw = sessionStorage.getItem(key(staffId, bookingId));
  } catch {
    throw new Error("Your browser could not read the saved billing action. Check browser storage and reconcile hotel records before continuing.");
  }
  if (raw === null) return null;
  let value;
  try { value = JSON.parse(raw); } catch { /* Treat an unreadable marker as unresolved. */ }
  if (!validAttempt(value, staffId, bookingId)) {
    throw new Error("A saved billing action could not be verified. Reconcile the refreshed bill and history with hotel records before continuing.");
  }
  return {
    kind: value.kind,
    payment: value.kind === "payment" ? { ...paymentAmount(value.amount), paymentMethod: value.paymentMethod } : null,
  };
}

export function saveBillingAttempt(staffId, bookingId, attempt) {
  const value = {
    kind: attempt.kind,
    staffId: Number(staffId),
    bookingId: Number(bookingId),
    ...(attempt.kind === "payment" ? { amount: attempt.payment.amount, paymentMethod: attempt.payment.paymentMethod } : {}),
  };
  if (!validAttempt(value, staffId, bookingId)) throw new Error("Review this billing action again before saving.");
  try {
    sessionStorage.setItem(key(staffId, bookingId), JSON.stringify(value));
  } catch {
    throw new Error("Your browser could not save a record of this billing attempt. No request was sent. Allow session storage before trying again.");
  }
}

export function clearBillingAttempt(staffId, bookingId) {
  try {
    sessionStorage.removeItem(key(staffId, bookingId));
  } catch {
    throw new Error("Your browser could not clear the saved billing action. Check browser storage before continuing.");
  }
}
