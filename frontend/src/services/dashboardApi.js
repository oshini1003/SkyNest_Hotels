import { API_BASE, clearSession } from "./session";
import { readStaffSession } from "./staffAuth";
import { isCurrentStaff, staffBookingId } from "./staffBookingApi";

const expiryMessage = "Your staff session has expired. Please sign in again.";
const accessMessage = "Manager or administrator access is required to view the dashboard.";
const unexpectedMessage = "The dashboard response could not be verified. Please refresh the dashboard.";
const roomFields = ["totalRooms", "occupiedRooms", "availableRooms", "maintenanceRooms"];
const countFields = [...roomFields, "todayCheckIns", "todayCompletedCheckIns", "todayCheckOuts",
  "todayCompletedCheckOuts", "todayPaymentsCount", "activeBookings"];

function failure(message, status = 0) {
  return Object.assign(new Error(message), { status });
}

export function canViewDashboard(role) {
  return ["Admin", "Manager"].includes(role);
}

function record(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function count(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function cashCents(value) {
  if (typeof value !== "string" || !/^\d+\.\d{2}$/.test(value)) return null;
  // Aggregate payment totals may be larger than Number's exact integer range.
  return BigInt(value.replace(".", ""));
}

export function formatDashboardMoney(value) {
  const cents = cashCents(value);
  if (cents === null) return "Unavailable";
  return `LKR ${(cents / 100n).toLocaleString("en-LK")}.${String(cents % 100n).padStart(2, "0")}`;
}

export function formatDashboardDate(value) {
  return validDate(value)
    ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" })
      .format(new Date(`${value}T00:00:00Z`))
    : "Unavailable";
}

function validRoomCounts(row, percentageField) {
  if (!record(row) || !roomFields.every((field) => count(row[field]))) return false;
  if (BigInt(row.occupiedRooms) + BigInt(row.availableRooms) + BigInt(row.maintenanceRooms) !== BigInt(row.totalRooms)) return false;
  const percentage = row[percentageField];
  if (row.totalRooms === 0) return percentage === null;
  const expected = Number(((row.occupiedRooms / row.totalRooms) * 100).toFixed(2));
  return typeof percentage === "number" && Number.isFinite(percentage) && percentage >= 0 &&
    percentage <= 100 && percentage === expected;
}

export function validateDashboardResponse(data, branchId) {
  const selectedId = branchId === "" ? null : staffBookingId(branchId);
  if (branchId !== "" && selectedId === null) return false;
  if (!record(data) || !validDate(data.date) || data.branchId !== (selectedId ?? "all")) return false;
  const summary = data.summary;
  if (!record(summary) || !countFields.every((field) => count(summary[field])) ||
      !validRoomCounts(summary, "currentOccupancyPercentage") || cashCents(summary.todayRevenue) === null ||
      summary.todayCompletedCheckIns > summary.todayCheckIns || summary.todayCompletedCheckOuts > summary.todayCheckOuts) return false;

  if (selectedId !== null) return !Object.prototype.hasOwnProperty.call(data, "branchBreakdown");
  if (!Array.isArray(data.branchBreakdown)) return false;
  const seen = new Set();
  const totals = Object.fromEntries(roomFields.map((field) => [field, 0n]));
  for (const branch of data.branchBreakdown) {
    if (!record(branch) || typeof branch.branchId !== "number" || staffBookingId(branch.branchId) === null ||
        seen.has(branch.branchId) || typeof branch.branchName !== "string" || !validRoomCounts(branch, "occupancyPercentage")) return false;
    seen.add(branch.branchId);
    for (const field of roomFields) totals[field] += BigInt(branch[field]);
  }
  return roomFields.every((field) => totals[field] === BigInt(summary[field]));
}

export async function loadManagerDashboard(branchId, token, signal) {
  const selectedId = branchId === "" ? null : staffBookingId(branchId);
  if (branchId !== "" && selectedId === null) throw failure("Select a valid branch.", 400);
  if (!isCurrentStaff(token)) throw failure(expiryMessage, 401);
  if (!canViewDashboard(readStaffSession()?.staff.role)) throw failure(accessMessage, 403);
  if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError");

  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 10000);
  let response;
  let data;
  try {
    response = await fetch(`${API_BASE}/dashboard/admin${selectedId === null ? "" : `?branchId=${selectedId}`}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: controller.signal,
    });
    data = await response.json().catch(() => null);
  } catch {
    if (signal?.aborted || !isCurrentStaff(token)) throw new DOMException("Request cancelled", "AbortError");
    throw failure(controller.signal.aborted
      ? "The dashboard request took too long. Please try again."
      : "The dashboard service is unavailable. Please try again.");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }

  // A stale response must neither expose a previous account's data nor clear a new sign-in.
  if (signal?.aborted || !isCurrentStaff(token)) throw new DOMException("Session changed", "AbortError");
  if (controller.signal.aborted) throw failure("The dashboard request took too long. Please try again.");
  if (response.status === 401) {
    clearSession("staff", expiryMessage);
    throw failure(expiryMessage, 401);
  }
  if (!canViewDashboard(readStaffSession()?.staff.role)) throw failure(accessMessage, 403);
  if (!response.ok) {
    const messages = {
      400: "The dashboard branch filter is invalid. Select a branch and try again.",
      403: accessMessage,
      404: "The dashboard is not available. Please contact your administrator.",
      429: "Too many requests. Please wait a moment and try again.",
    };
    throw failure(messages[response.status] || "The dashboard service is unavailable. Please try again.", response.status);
  }
  if (response.status !== 200 || !validateDashboardResponse(data, branchId)) throw failure(unexpectedMessage, response.status);
  return data;
}
