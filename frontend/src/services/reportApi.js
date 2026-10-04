import { API_BASE, clearSession } from "./session";
import { readStaffSession } from "./staffAuth";
import { bookingStatuses, isCurrentStaff, staffBookingId } from "./staffBookingApi";
import { moneyCents } from "./billingApi";

const reportTypes = ["occupancy", "billing-summary", "service-usage", "revenue", "top-services"];
const expiryMessage = "Your staff session has expired. Please sign in again.";
const unexpectedMessage = "The report response could not be verified. Please refresh the report.";

function failure(message, status = 0) {
  return Object.assign(new Error(message), { status });
}

export function canViewReports(role) {
  return ["Admin", "Manager"].includes(role);
}

function count(value) {
  return ["number", "string"].includes(typeof value) && /^\d+$/.test(String(value)) &&
    Number.isSafeInteger(Number(value)) && Number(value) >= 0;
}

function amount(value, signed = false) {
  return typeof value === "string" && moneyCents(value, signed) !== null;
}

export function formatReportMoney(value) {
  const cents = moneyCents(value, true);
  if (cents === null) return "Unavailable";
  const absolute = BigInt(cents < 0 ? -cents : cents);
  return `LKR ${cents < 0 ? "−" : ""}${(absolute / 100n).toLocaleString("en-LK")}.${String(absolute % 100n).padStart(2, "0")}`;
}

function serverDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value.replace(" ", "T")}Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 19).replace("T", " ") === value;
}

function branchScope(row) {
  return typeof row.BranchName === "string" && (
    (row.BranchScope === "single" && staffBookingId(row.BranchID) !== null) ||
    (["multiple", "unassigned"].includes(row.BranchScope) && row.BranchID === null)
  );
}

function totalsAgree(total, first, second) {
  return BigInt(moneyCents(total)) === BigInt(moneyCents(first)) + BigInt(moneyCents(second));
}

function validRow(type, row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return false;
  if (type === "occupancy") {
    if (staffBookingId(row.BranchID) === null || typeof row.BranchName !== "string" ||
        ![row.Occupied, row.Available, row.Maintenance, row.TotalRooms].every(count)) return false;
    return BigInt(row.Occupied) + BigInt(row.Available) + BigInt(row.Maintenance) === BigInt(row.TotalRooms);
  }
  if (type === "billing-summary") {
    if (staffBookingId(row.BookingID) === null || staffBookingId(row.BillID) === null ||
        typeof row.GuestName !== "string" || !bookingStatuses.includes(row.BookingStatus) ||
        !["Unpaid", "Partially Paid", "Paid"].includes(row.BillStatus) || !serverDate(row.GeneratedDateDisplay) ||
        !branchScope(row) || ![row.TotalAmount, row.PaidAmount, row.RoomCharges, row.ServiceCharges].every((value) => amount(value)) ||
        !amount(row.OutstandingBalance, true)) return false;
    return totalsAgree(row.TotalAmount, row.RoomCharges, row.ServiceCharges) &&
      BigInt(moneyCents(row.TotalAmount)) - BigInt(moneyCents(row.PaidAmount)) === BigInt(moneyCents(row.OutstandingBalance, true));
  }
  if (type === "revenue") {
    return branchScope(row) && typeof row.Month === "string" && /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(row.Month) &&
      count(row.BillCount) && [row.RoomRevenue, row.ServiceRevenue, row.TotalRevenue].every((value) => amount(value)) &&
      totalsAgree(row.TotalRevenue, row.RoomRevenue, row.ServiceRevenue);
  }
  return staffBookingId(row.ServiceID) !== null && typeof row.ServiceName === "string" &&
    count(row.TimesUsed) && count(row.TotalQuantity) &&
    (type === "service-usage" ? amount(row.TotalRevenue) : (row.TotalRevenue === undefined || amount(row.TotalRevenue)));
}

function rowKey(type, row) {
  if (type === "occupancy") return String(row.BranchID);
  if (type === "billing-summary") return String(row.BillID);
  if (type === "revenue") return `${row.BranchScope}:${row.BranchID}:${row.Month}`;
  return String(row.ServiceID);
}

async function request(path, token, signal) {
  if (!isCurrentStaff(token)) throw failure(expiryMessage, 401);
  if (!canViewReports(readStaffSession()?.staff.role)) throw failure("Manager or administrator access is required to view reports.", 403);
  if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 10000);
  let response;
  let data;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: controller.signal,
    });
    data = await response.json().catch(() => null);
  } catch {
    if (signal?.aborted || !isCurrentStaff(token)) throw new DOMException("Request cancelled", "AbortError");
    throw failure("The report service is unavailable. Please try again.");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
  if (signal?.aborted || !isCurrentStaff(token)) throw new DOMException("Session changed", "AbortError");
  if (response.status === 401) {
    clearSession("staff", expiryMessage);
    throw failure(expiryMessage, 401);
  }
  if (!response.ok) {
    const messages = {
      400: "The report filters are invalid. Check them and try again.",
      403: "Manager or administrator access is required to view reports.",
      404: "This report is not available. Please contact your administrator.",
      429: "Too many requests. Please wait a moment and try again.",
    };
    throw failure(messages[response.status] || "The report service is unavailable. Please try again.", response.status);
  }
  if (response.status !== 200) throw failure(unexpectedMessage, response.status);
  return data;
}

export async function loadManagerReport(type, filters, token, signal) {
  if (!reportTypes.includes(type)) throw failure("Select a valid report.", 400);
  const query = new URLSearchParams();
  const branchId = filters?.branchId;
  if (branchId !== "" && branchId !== undefined) {
    if (staffBookingId(branchId) === null) throw failure("Select a valid branch.", 400);
    query.set("branchId", branchId);
  }
  if (type === "billing-summary") {
    if (typeof filters?.outstandingOnly !== "boolean") throw failure("Choose whether to show outstanding bills only.", 400);
    query.set("outstandingOnly", String(filters.outstandingOnly));
  }
  if (type === "revenue") {
    const year = String(filters?.year ?? "");
    const month = String(filters?.month ?? "");
    if ((year && !/^[1-9]\d{3}$/.test(year)) || (month && (!year || !/^(?:[1-9]|1[0-2])$/.test(month)))) {
      throw failure("Enter a year from 1000 to 9999. Select a year before choosing a month.", 400);
    }
    if (year) query.set("year", year);
    if (month) query.set("month", month);
  }
  if (type === "top-services") {
    const limit = String(filters?.limit ?? "5");
    if (!/^(?:[1-9]|[1-4]\d|50)$/.test(limit)) throw failure("Choose a limit from 1 to 50.", 400);
    query.set("limit", limit);
  }
  const data = await request(`/reports/${type}${query.size ? `?${query}` : ""}`, token, signal);
  if (!Array.isArray(data) || data.some((row) => !validRow(type, row)) ||
      new Set(data.map((row) => rowKey(type, row))).size !== data.length) throw failure(unexpectedMessage);
  if (type === "billing-summary" && new Set(data.map((row) => String(row.BookingID))).size !== data.length) throw failure(unexpectedMessage);
  if (query.has("branchId") && ["occupancy", "billing-summary", "revenue"].includes(type) &&
      data.some((row) => staffBookingId(row.BranchID) !== Number(query.get("branchId")))) throw failure(unexpectedMessage);
  if (type === "billing-summary" && filters.outstandingOnly && data.some((row) => moneyCents(row.OutstandingBalance, true) <= 0)) throw failure(unexpectedMessage);
  if (type === "revenue" && data.some((row) =>
    (query.has("year") && row.Month.slice(0, 4) !== query.get("year")) ||
    (query.has("month") && Number(row.Month.slice(5)) !== Number(query.get("month"))))) throw failure(unexpectedMessage);
  if (type === "top-services" && data.length > Number(query.get("limit"))) throw failure(unexpectedMessage);
  return data;
}
