import { API_BASE, clearSession } from "./session";
import { readStaffSession } from "./staffAuth";

export const bookingStatuses = ["Booked", "Checked-In", "Checked-Out", "Cancelled"];
const expiryMessage = "Your staff session has expired. Please sign in again.";
const unexpectedMessage = "The booking service returned an unexpected response. Please try again.";
const scopeMessage = "Your branch access could not be verified. Please try again.";
const staffRoles = ["Admin", "Manager", "Receptionist", "ServiceStaff"];
const uncertainMessage = "We could not confirm the check-in result. Check the current status before trying again.";

function failure(message, status = 0, outcomeUnknown = false) {
  return Object.assign(new Error(message), { status, outcomeUnknown });
}

export function staffBookingId(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (!/^[1-9]\d*$/.test(String(value))) return null;
  const id = Number(value);
  return Number.isInteger(id) && id <= 2147483647 ? id : null;
}

export function canCheckIn(role) {
  return ["Admin", "Manager", "Receptionist"].includes(role);
}

export function isCurrentStaff(token) {
  return Boolean(token) && readStaffSession()?.token === token;
}

async function request(path, token, signal, method = "GET", scopeRequest = false) {
  if (!isCurrentStaff(token)) throw failure(expiryMessage, 401);
  if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 10000);
  const mutation = method !== "GET";
  let response;
  let data;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      ...(mutation ? { body: "{}" } : {}),
      cache: "no-store",
      signal: controller.signal,
    });
    data = await response.json().catch(() => null);
  } catch {
    if (signal?.aborted || !isCurrentStaff(token)) throw new DOMException("Request cancelled", "AbortError");
    throw failure(mutation ? uncertainMessage : "The booking service is unavailable. Please try again.", 0, mutation);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
  // An old request cannot reveal data to, or sign out, a newly signed-in user.
  if (signal?.aborted || !isCurrentStaff(token)) throw new DOMException("Session changed", "AbortError");
  if (controller.signal.aborted) throw failure(mutation ? uncertainMessage : "The booking request took too long. Please try again.", 0, mutation);
  if (response.status === 401) {
    clearSession("staff", expiryMessage);
    throw failure(expiryMessage, 401);
  }
  if (!response.ok) {
    if (scopeRequest) {
      throw failure(response.status === 403
        ? "Your staff account has no valid branch access. Please contact your administrator."
        : scopeMessage, response.status);
    }
    const unknown = mutation && response.status >= 500;
    throw failure(unknown ? uncertainMessage : (typeof data?.error === "string" ? data.error : "Unable to complete this request."), response.status, unknown);
  }
  if (scopeRequest && (response.status !== 200 || !data)) throw failure(scopeMessage, response.status);
  if (!data) throw failure(mutation ? uncertainMessage : unexpectedMessage, response.status, mutation);
  return data;
}

function validDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

export function formatStayDate(value) {
  return validDay(value) ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)) : "Unavailable";
}

function validBooking(booking) {
  return booking && staffBookingId(booking.BookingID) !== null &&
    bookingStatuses.includes(booking.BookingStatus) && typeof booking.GuestName === "string" &&
    Array.isArray(booking.rooms) && booking.rooms.every((room) =>
      room && staffBookingId(room.RoomID) !== null && typeof room.BranchName === "string" &&
      typeof room.RoomTypeName === "string" && ["string", "number"].includes(typeof room.RoomNumber) &&
      validDay(room.CheckInDate) && validDay(room.CheckOutDate) &&
      ["Available", "Occupied", "Maintenance"].includes(room.RoomStatus));
}

export function isBranchRestricted(role) {
  return ["Receptionist", "ServiceStaff"].includes(role);
}

export async function loadStaffScope(token, signal) {
  const session = readStaffSession();
  if (!session || session.token !== token) throw failure(expiryMessage, 401);
  if (staffBookingId(session.staff.staffId) === null || !staffRoles.includes(session.staff.role)) {
    throw failure("A valid staff account is required.", 403);
  }
  const data = await request("/staff/scope", token, signal, "GET", true);
  const positiveNumber = (value) => typeof value === "number" && staffBookingId(value) !== null;
  const assignedBranch = positiveNumber(data.branchId) && typeof data.branchName === "string" && data.branchName.trim() !== "";
  if (typeof data !== "object" || Array.isArray(data) || !positiveNumber(data.staffId) ||
      !staffRoles.includes(data.role) ||
      !(assignedBranch || (!isBranchRestricted(data.role) && data.branchId === null && data.branchName === null))) {
    throw failure(scopeMessage);
  }
  // The server verifies live staff assignment against the token. Browser profile
  // branchId is only cached display data and must not override that result.
  if (data.staffId !== staffBookingId(session.staff.staffId) || data.role !== session.staff.role) {
    clearSession("staff", expiryMessage);
    throw failure(expiryMessage, 401);
  }
  return { staffId: data.staffId, role: data.role, branchId: data.branchId, branchName: data.branchName };
}

// Every search, including Clear filters and retries, resolves access before any
// booking query. The API independently enforces the same scope on every endpoint.
export async function loadStaffBookingSearch(filters, token, signal) {
  const scope = await loadStaffScope(token, signal);
  const restricted = isBranchRestricted(scope.role);
  const branches = restricted ? [] : await loadStaffBranches(token, signal);
  const bookings = await loadStaffBookings(
    restricted ? { ...filters, branchId: String(scope.branchId) } : filters,
    token, signal,
  );
  return { scope, branches, bookings };
}

export async function loadStaffBranches(token, signal) {
  const data = await request("/branches", token, signal);
  if (!Array.isArray(data) || data.some((branch) => !branch || staffBookingId(branch.BranchID) === null || typeof branch.Name !== "string")) {
    throw failure("Unable to load branch options. Please try again.");
  }
  return data;
}

export async function loadStaffBookings(filters, token, signal) {
  const query = new URLSearchParams();
  for (const field of ["bookingId", "guestName", "idNumber", "branchId", "status"]) {
    const value = String(filters[field] || "").trim();
    if (!value) continue;
    if (["bookingId", "branchId"].includes(field) && staffBookingId(value) === null) {
      throw failure("Booking reference and branch must be positive whole numbers.");
    }
    query.set(field, value);
  }
  const data = await request(`/bookings${query.size ? `?${query}` : ""}`, token, signal);
  if (!Array.isArray(data) || data.some((booking) => !validBooking(booking))) throw failure(unexpectedMessage);
  return data;
}

export async function loadStaffBooking(id, token, signal) {
  const bookingId = staffBookingId(id);
  if (bookingId === null) throw failure("Enter a valid booking reference.", 400);
  const data = await request(`/bookings/${bookingId}`, token, signal);
  const eligibility = data.checkInEligibility;
  if (!validBooking(data) || Number(data.BookingID) !== bookingId || !eligibility ||
      typeof eligibility.allowed !== "boolean" || !validDay(eligibility.today) ||
      !(eligibility.reason === null || typeof eligibility.reason === "string")) throw failure(unexpectedMessage);
  return data;
}

export async function checkInStaffBooking(id, token, signal) {
  const bookingId = staffBookingId(id);
  if (bookingId === null) throw failure("Enter a valid booking reference.", 400);
  const data = await request(`/bookings/${bookingId}/check-in`, token, signal, "POST");
  if (data.bookingId !== bookingId || data.status !== "Checked-In") throw failure(uncertainMessage, 0, true);
  return data;
}
