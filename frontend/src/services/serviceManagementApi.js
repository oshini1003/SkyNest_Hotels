import { API_BASE, clearSession } from "./session";
import { readStaffSession } from "./staffAuth";

const expiryMessage = "Your staff session has expired. Please sign in again.";
const accessMessage = "Only managers and administrators can manage the service catalogue.";
const catalogueMessage = "The service catalogue could not be loaded. Please refresh and try again.";
const uncertainMessage = "We could not confirm whether this catalogue change was saved. Refresh the catalogue and check the service before clearing this action or saving again.";
const inFlight = new Set();
const controls = /[\u0000-\u001f\u007f-\u009f]/;

function failure(message, status = 0, outcomeUnknown = false) {
  return Object.assign(new Error(message), { status, outcomeUnknown });
}
function cancelled(outcomeUnknown = false) {
  return Object.assign(new DOMException("Request cancelled or session changed", "AbortError"), { outcomeUnknown });
}
function id(value) {
  if (!["number", "string"].includes(typeof value) || !/^[1-9]\d*$/.test(String(value))) return null;
  const number = Number(value);
  return Number.isInteger(number) && number <= 2147483647 ? number : null;
}
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function text(value, maximum, required = false) {
  return typeof value === "string" && !controls.test(value) && [...value].length <= maximum && (!required || value.trim().length > 0);
}
function price(value) {
  if (!["string", "number"].includes(typeof value)) return null;
  const match = /^(0|[1-9]\d{0,7})(?:\.(\d{1,2}))?$/.exec(String(value));
  return match ? `${match[1]}.${(match[2] || "").padEnd(2, "0")}` : null;
}

export function canManageServices(role) { return ["Admin", "Manager"].includes(role); }
function currentStaff(token, staffId) {
  const session = readStaffSession();
  const currentId = id(session?.staff?.staffId);
  return typeof token === "string" && token && session?.token === token && currentId !== null &&
    canManageServices(session.staff.role) && (staffId === undefined || staffId === currentId) ? currentId : null;
}
function requireManager(token) {
  const session = readStaffSession();
  if (!session || session.token !== token || id(session.staff.staffId) === null) throw failure(expiryMessage, 401);
  if (!canManageServices(session.staff.role)) throw failure(accessMessage, 403);
  return id(session.staff.staffId);
}
function expireCurrent(token, staffId) {
  if (currentStaff(token, staffId) !== null) {
    try { clearSession("staff", expiryMessage); } catch { /* Preserve the HTTP outcome if notice storage fails. */ }
  }
}

export function parseServiceDraft(draft) {
  if (!object(draft) || typeof draft.serviceName !== "string" || controls.test(draft.serviceName)) {
    throw failure("Enter the service name as a single line of plain text.", 400);
  }
  const serviceName = draft.serviceName.trim();
  if (!text(serviceName, 100, true)) throw failure("Enter a service name from 1 to 100 characters.", 400);
  if (draft.description !== undefined && draft.description !== null &&
      (typeof draft.description !== "string" || controls.test(draft.description))) {
    throw failure("Enter the description as a single line of plain text.", 400);
  }
  const description = typeof draft.description === "string" ? draft.description.trim() || null : null;
  if (description !== null && !text(description, 255)) throw failure("The description must be 255 characters or fewer.", 400);
  const unitPrice = typeof draft.unitPrice === "string" ? price(draft.unitPrice.trim()) : null;
  if (unitPrice === null) throw failure("Enter a price from 0.00 to 99999999.99, with at most two decimal places.", 400);
  return { serviceName, description, unitPrice };
}

function snapshot(value) {
  if (!object(value) || !text(value.ServiceName, 100, true) ||
      !(value.Description === null || text(value.Description, 255)) ||
      price(value.UnitPrice) === null || ![true, false, 0, 1].includes(value.IsActive)) return null;
  return { ServiceName: value.ServiceName, Description: value.Description, UnitPrice: price(value.UnitPrice), IsActive: Boolean(value.IsActive) };
}
function service(value) {
  const saved = snapshot(value);
  const serviceId = id(value?.ServiceID);
  return saved && serviceId !== null ? { ServiceID: serviceId, ...saved } : null;
}
function serviceList(value) {
  if (!Array.isArray(value)) return null;
  const seen = new Set();
  const rows = [];
  for (const item of value) {
    const parsed = service(item);
    if (!parsed || seen.has(parsed.ServiceID)) return null;
    seen.add(parsed.ServiceID); rows.push(parsed);
  }
  return rows;
}
function attemptKey(staffId) {
  const staff = id(staffId);
  if (staff === null) throw failure("Sign in with a valid manager account before changing services.", 400);
  return `skynest_service_management_attempt:${staff}`;
}
function validAttempt(value, staffId) {
  const fields = ["staffId", "serviceId", "serviceName", "description", "unitPrice", "isActive", "stage"];
  if (!object(value) || Object.keys(value).length !== fields.length || Object.keys(value).some((field) => !fields.includes(field)) ||
      value.staffId !== Number(staffId) || !(value.serviceId === null || (id(value.serviceId) === value.serviceId && value.serviceId !== null)) ||
      !["pending", "saved"].includes(value.stage) || typeof value.isActive !== "boolean" ||
      (value.stage === "saved" && value.serviceId === null)) return false;
  try {
    const parsed = parseServiceDraft(value);
    return Object.keys(parsed).every((field) => parsed[field] === value[field]);
  } catch { return false; }
}
export function readManagedServiceAttempt(staffId) {
  const key = attemptKey(staffId);
  let raw;
  try { raw = sessionStorage.getItem(key); } catch {
    throw failure("Your browser could not read the saved catalogue action. Check browser storage and reconcile the catalogue before continuing.");
  }
  if (raw === null) return null;
  let value;
  try { value = JSON.parse(raw); } catch { /* An unreadable marker must block another write. */ }
  if (!validAttempt(value, staffId)) throw failure("A saved catalogue action could not be verified. Check the catalogue before clearing this action.");
  return value;
}
export function clearManagedServiceAttempt(staffId) {
  const key = attemptKey(staffId);
  if (inFlight.has(key)) throw failure("Please wait for the current catalogue change to finish.");
  try {
    sessionStorage.removeItem(key);
    if (sessionStorage.getItem(key) !== null) throw new Error("Removal was not saved.");
  } catch { throw failure("Your browser could not clear the saved catalogue action. Check browser storage before continuing."); }
}
function persistAttempt(key, attempt) {
  const raw = JSON.stringify(attempt);
  sessionStorage.setItem(key, raw);
  if (sessionStorage.getItem(key) !== raw) throw new Error("Storage write could not be verified.");
}

export async function loadManagedServices(token, signal) {
  const staffId = requireManager(token);
  if (signal?.aborted) throw cancelled();
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 10000);
  let response;
  let data;
  try {
    response = await fetch(`${API_BASE}/management/services`, {
      method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      cache: "no-store", redirect: "error", signal: controller.signal,
    });
    data = await response.json().catch(() => null);
  } catch {
    if (signal?.aborted || currentStaff(token, staffId) === null) throw cancelled();
    throw failure(controller.signal.aborted ? "The catalogue took too long to respond. Please refresh." : catalogueMessage);
  } finally {
    clearTimeout(timer); signal?.removeEventListener("abort", abort);
  }
  if (signal?.aborted || currentStaff(token, staffId) === null) throw cancelled();
  if (controller.signal.aborted) throw failure("The catalogue took too long to respond. Please refresh.");
  if (response.status === 401) { expireCurrent(token, staffId); throw failure(expiryMessage, 401); }
  if (response.status !== 200 || !response.ok) throw failure(response.status === 403 ? accessMessage : catalogueMessage, response.status);
  const rows = serviceList(data);
  if (rows === null) throw failure("The service catalogue could not be verified. Please refresh before editing services.", response.status);
  return rows;
}

export async function saveManagedService(draft, token, signal) {
  const parsed = parseServiceDraft(draft);
  const creating = draft.serviceId === null;
  const serviceId = creating ? null : id(draft.serviceId);
  if (!creating && serviceId === null) throw failure("Choose a valid service to edit.", 400);
  const expected = creating ? null : snapshot(draft.expected);
  if (!creating && (!expected || typeof draft.isActive !== "boolean" ||
      (draft.expected.ServiceID !== undefined && id(draft.expected.ServiceID) !== serviceId))) {
    throw failure("Refresh the service and review its current values before editing.", 400);
  }
  const staffId = requireManager(token);
  if (signal?.aborted) throw cancelled();
  const key = attemptKey(staffId);
  if (inFlight.has(key) || readManagedServiceAttempt(staffId)) {
    throw failure("Check the previous catalogue action before saving another change.", 0, true);
  }
  const isActive = creating ? true : draft.isActive;
  const attempt = { staffId, serviceId, ...parsed, isActive, stage: "pending" };
  try { persistAttempt(key, attempt); } catch {
    throw failure("Your browser could not save this action for checking later. No request was sent. Allow session storage before continuing.");
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
      // Exactly one write. Read-only refreshes and navigation never replay this request.
      response = await fetch(`${API_BASE}/services${creating ? "" : `/${serviceId}`}`, {
        method: creating ? "POST" : "PUT",
        headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(creating ? parsed : { ...parsed, isActive, expected }),
        cache: "no-store", redirect: "error", signal: controller.signal,
      });
      data = await response.json().catch(() => null);
    } catch {
      if (signal?.aborted || currentStaff(token, staffId) === null) throw cancelled(true);
      throw failure(uncertainMessage, 0, true);
    }
    if (signal?.aborted || currentStaff(token, staffId) === null) throw cancelled(true);
    if (controller.signal.aborted) throw failure(uncertainMessage, 0, true);
    const row = service(data?.service);
    if (response.ok && response.status === (creating ? 201 : 200) && data?.saved === true && row &&
        (creating || row.ServiceID === serviceId) && row.ServiceName === parsed.serviceName &&
        row.Description === parsed.description && row.UnitPrice === parsed.unitPrice && row.IsActive === isActive) {
      try { persistAttempt(key, { ...attempt, serviceId: row.ServiceID, stage: "saved" }); } catch {
        // The server acknowledgement remains authoritative even when browser storage fails.
        return { saved: true, service: row, storageNotice: "The service was saved, but this browser could not update its saved-action record. Check the service before continuing." };
      }
      return { saved: true, service: row };
    }
    const rejections = {
      400: "Check the service name, description and price. The change was not saved.",
      401: expiryMessage,
      403: accessMessage,
      404: "This service could not be found. Refresh the catalogue.",
      409: "This service changed or conflicts with another service. Refresh the catalogue and review your edit again.",
      422: "The catalogue change was not accepted. Check the service details.",
      429: "Too many requests. Please wait before trying again.",
    };
    if (!response.ok && rejections[response.status]) {
      try { sessionStorage.removeItem(key); } catch { /* Keep the marker blocked if removal is unavailable. */ }
      if (response.status === 401) expireCurrent(token, staffId);
      throw failure(rejections[response.status], response.status);
    }
    throw failure(uncertainMessage, response.status, true);
  } finally {
    clearTimeout(timer); signal?.removeEventListener("abort", abort); inFlight.delete(key);
  }
}
