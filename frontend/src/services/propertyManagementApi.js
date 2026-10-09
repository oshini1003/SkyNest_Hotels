import { API_BASE, clearSession } from "./session";
import { readStaffSession } from "./staffAuth";

const expiryMessage = "Your staff session has expired. Please sign in again.";
const accessMessage = "Only managers and administrators can manage branches and room types.";
const loadMessage = "The property catalogue could not be verified. Please refresh and try again.";
const uncertainMessage = "We could not confirm whether this item was saved. Refresh the list and check it before clearing this action or adding the item again.";
const inFlight = new Set();
// Reject line breaks and invisible control characters in single-line fields.
// eslint-disable-next-line no-control-regex
const controls = /[\u0000-\u001f\u007f-\u009f]/;

function failure(message, status = 0, outcomeUnknown = false) {
  return Object.assign(new Error(message), { status, outcomeUnknown });
}
function cancelled(outcomeUnknown = false) {
  return Object.assign(new DOMException("Request cancelled or session changed", "AbortError"), { outcomeUnknown });
}
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function integer(value) {
  if (!["number", "string"].includes(typeof value) || !/^[1-9]\d*$/.test(String(value))) return null;
  const number = Number(value);
  return Number.isInteger(number) && number <= 2147483647 ? number : null;
}
function plainText(value, maximum) {
  return typeof value === "string" && !controls.test(value) && value.trim().length > 0 && [...value].length <= maximum;
}
function money(value) {
  if (!["string", "number"].includes(typeof value)) return null;
  const match = /^(0|[1-9]\d{0,7})(?:\.(\d{1,2}))?$/.exec(String(value));
  return match ? `${match[1]}.${(match[2] || "").padEnd(2, "0")}` : null;
}
function catalogueKind(kind) {
  if (!["branches", "room-types"].includes(kind)) throw failure("Choose branches or room types.", 400);
  return kind;
}
function draftText(value, maximum, label) {
  if (typeof value !== "string" || controls.test(value) || !plainText(value.trim(), maximum)) {
    throw failure(`Enter ${label} using 1 to ${maximum} characters on one line.`, 400);
  }
  return value.trim();
}

export function canManageProperty(role) { return ["Admin", "Manager"].includes(role); }
export function parseBranchDraft(draft) {
  if (!object(draft)) throw failure("Enter the branch details.", 400);
  const name = draftText(draft.name, 100, "a branch name");
  const location = draftText(draft.location, 150, "a location");
  const contactNumber = draftText(draft.contactNumber, 20, "a contact number");
  if (!/^\+?[\d ()-]+$/.test(contactNumber) || !/^\d{7,15}$/.test(contactNumber.replace(/\D/g, ""))) {
    throw failure("Enter a contact number with 7 to 15 digits. Spaces, parentheses, hyphens and a leading + are allowed.", 400);
  }
  return { name, location, contactNumber };
}
export function parseRoomTypeDraft(draft) {
  if (!object(draft)) throw failure("Enter the room type details.", 400);
  const name = draftText(draft.name, 100, "a room type name");
  const capacity = integer(draft.capacity);
  // Existing guest selectors render a capacity-sized list; keep new types within the current UI limit.
  if (capacity === null || capacity > 100) throw failure("Enter a guest capacity from 1 to 100, using whole numbers.", 400);
  const dailyRate = typeof draft.dailyRate === "string" ? money(draft.dailyRate.trim()) : null;
  if (dailyRate === null) throw failure("Enter a nightly rate from 0.00 to 99999999.99 with at most two decimal places.", 400);
  if (!Array.isArray(draft.amenityIds)) throw failure("Choose amenities from the available list.", 400);
  const amenityIds = draft.amenityIds.map(integer);
  if (amenityIds.includes(null) || new Set(amenityIds).size !== amenityIds.length) {
    throw failure("Choose each valid amenity only once.", 400);
  }
  return { name, capacity, dailyRate, amenityIds };
}
function parseDraft(kind, draft) { return kind === "branches" ? parseBranchDraft(draft) : parseRoomTypeDraft(draft); }

function currentStaff(token, staffId) {
  const session = readStaffSession();
  const currentId = integer(session?.staff?.staffId);
  return Boolean(token) && session?.token === token && currentId !== null && canManageProperty(session.staff.role) &&
    (staffId === undefined || currentId === staffId) ? currentId : null;
}
function requireManager(token) {
  const session = readStaffSession();
  if (!session || session.token !== token || integer(session.staff.staffId) === null) throw failure(expiryMessage, 401);
  if (!canManageProperty(session.staff.role)) throw failure(accessMessage, 403);
  return integer(session.staff.staffId);
}
function requireAttemptOwner(staffId) {
  const session = readStaffSession();
  if (integer(staffId) === null || currentStaff(session?.token, integer(staffId)) === null) throw failure(expiryMessage, 401);
  return integer(staffId);
}
function expireCurrent(token, staffId) {
  if (currentStaff(token, staffId) !== null) {
    try { clearSession("staff", expiryMessage); } catch { /* Never replace the request outcome with a browser storage error. */ }
  }
}

async function request(path, token, staffId, signal, draft) {
  const mutation = draft !== undefined;
  if (currentStaff(token, staffId) === null) throw cancelled();
  if (signal?.aborted) throw cancelled();
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 10000);
  let response;
  let data;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: mutation ? "POST" : "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...(mutation ? { "Content-Type": "application/json" } : {}) },
      ...(mutation ? { body: JSON.stringify(draft) } : {}),
      cache: "no-store", redirect: "error", signal: controller.signal,
    });
    data = await response.json().catch(() => null);
  } catch {
    if (signal?.aborted || currentStaff(token, staffId) === null) throw cancelled(mutation);
    throw failure(mutation ? uncertainMessage : (controller.signal.aborted ? "The property request took too long. Please refresh." : loadMessage), 0, mutation);
  } finally {
    clearTimeout(timer); signal?.removeEventListener("abort", abort);
  }
  if (signal?.aborted || currentStaff(token, staffId) === null) throw cancelled(mutation);
  if (controller.signal.aborted) throw failure(mutation ? uncertainMessage : "The property request took too long. Please refresh.", 0, mutation);
  return { response, data };
}
function readResult(result, token, staffId) {
  const { response, data } = result;
  if (response.status === 401) { expireCurrent(token, staffId); throw failure(expiryMessage, 401); }
  if (!response.ok || response.status !== 200) throw failure(response.status === 403 ? accessMessage : loadMessage, response.status);
  return data;
}
async function liveScope(token, staffId, signal) {
  const data = readResult(await request("/staff/scope", token, staffId, signal), token, staffId);
  const assigned = object(data) && typeof data.branchId === "number" && integer(data.branchId) !== null && plainText(data.branchName, 100);
  if (!object(data) || typeof data.staffId !== "number" || data.staffId !== staffId ||
      !canManageProperty(data.role) || data.role !== readStaffSession()?.staff.role ||
      !(assigned || (data.branchId === null && data.branchName === null))) {
    throw failure("Your current management access could not be verified. Please sign in again.", 403);
  }
}
function rows(value, kind) {
  if (!Array.isArray(value)) throw failure(loadMessage);
  const seen = new Set();
  return value.map((row) => {
    const idKey = kind === "branches" ? "BranchID" : kind === "room-types" ? "RoomTypeID" : "AmenityID";
    const id = integer(row?.[idKey]);
    if (!object(row) || id === null || seen.has(id)) throw failure(loadMessage);
    seen.add(id);
    if (kind === "amenities") {
      if (!plainText(row.AmenityName, 100)) throw failure(loadMessage);
      return { AmenityID: id, AmenityName: row.AmenityName };
    }
    if (!plainText(row.Name, 100)) throw failure(loadMessage);
    if (kind === "branches") {
      // Existing contact text is preserved; only new entries require the form's phone format.
      if (!plainText(row.Location, 150) || !plainText(row.ContactNumber, 20)) throw failure(loadMessage);
      return { BranchID: id, Name: row.Name, Location: row.Location, ContactNumber: row.ContactNumber };
    }
    if (integer(row.Capacity) === null || money(row.DailyRate) === null || !Array.isArray(row.amenities) ||
        row.amenities.some((name) => !plainText(name, 100)) || new Set(row.amenities).size !== row.amenities.length) throw failure(loadMessage);
    return { RoomTypeID: id, Name: row.Name, Capacity: integer(row.Capacity), DailyRate: money(row.DailyRate), amenities: [...row.amenities] };
  });
}

export async function loadPropertyCatalogue(kind, token, signal) {
  catalogueKind(kind);
  const staffId = requireManager(token);
  await liveScope(token, staffId, signal);
  const results = await Promise.all([
    request(`/${kind}`, token, staffId, signal),
    ...(kind === "room-types" ? [request("/amenities", token, staffId, signal)] : []),
  ]);
  if (currentStaff(token, staffId) === null || signal?.aborted) throw cancelled();
  const catalogueRows = rows(readResult(results[0], token, staffId), kind);
  const amenities = results.length === 2 ? rows(readResult(results[1], token, staffId), "amenities") : [];
  return { rows: catalogueRows, amenities };
}

function attemptKey(kind, staffId) { return `skynest_property_attempt:${catalogueKind(kind)}:${staffId}`; }
function validAttempt(value, kind, staffId) {
  if (!object(value) || Object.keys(value).length !== 5 || Object.keys(value).some((key) => !["kind", "staffId", "stage", "id", "draft"].includes(key)) ||
      value.kind !== kind || value.staffId !== staffId || !["pending", "saved"].includes(value.stage) ||
      !(value.stage === "pending" ? value.id === null : typeof value.id === "number" && integer(value.id) !== null)) return false;
  try {
    const parsed = parseDraft(kind, value.draft);
    return Object.keys(parsed).length === Object.keys(value.draft).length &&
      Object.keys(parsed).every((field) => JSON.stringify(parsed[field]) === JSON.stringify(value.draft[field]));
  } catch { return false; }
}
export function readPropertyAttempt(kind, staffId) {
  const owner = requireAttemptOwner(staffId);
  const key = attemptKey(kind, owner);
  let raw;
  try { raw = sessionStorage.getItem(key); } catch { throw failure("Your browser could not read the saved property action. Check browser storage before continuing.", 0, true); }
  if (raw === null) return null;
  let value;
  try { value = JSON.parse(raw); } catch { /* An unreadable action still blocks a duplicate create. */ }
  if (!validAttempt(value, kind, owner)) throw failure("A saved property action could not be verified. Refresh and check the list before clearing this action.", 0, true);
  return value;
}
export function clearPropertyAttempt(kind, staffId) {
  const key = attemptKey(kind, requireAttemptOwner(staffId));
  if (inFlight.has(key)) throw failure("Please wait for the current property action to finish.");
  try {
    sessionStorage.removeItem(key);
    if (sessionStorage.getItem(key) !== null) throw new Error("Removal not saved");
  } catch { throw failure("Your browser could not clear the saved property action. Check browser storage before continuing."); }
}
function persistAttempt(key, attempt) {
  const raw = JSON.stringify(attempt);
  sessionStorage.setItem(key, raw);
  if (sessionStorage.getItem(key) !== raw) throw new Error("Storage write was not retained");
}
function acknowledgement(kind, data, draft) {
  if (!object(data) || data.name !== draft.name) return null;
  if (kind === "branches") {
    const id = integer(data.branchId);
    return id !== null && data.location === draft.location && data.contactNumber === draft.contactNumber ? id : null;
  }
  const id = integer(data.roomTypeId);
  return id !== null && integer(data.capacity) === draft.capacity && money(data.dailyRate) === draft.dailyRate ? id : null;
}

export async function createPropertyItem(kind, draft, token, signal) {
  catalogueKind(kind);
  const parsed = parseDraft(kind, draft);
  const staffId = requireManager(token);
  if (signal?.aborted) throw cancelled();
  const key = attemptKey(kind, staffId);
  if (inFlight.has(key) || readPropertyAttempt(kind, staffId)) throw failure("Check the previous property action before adding another item.", 0, true);
  // Acquire synchronously, including the live scope check, so two clicks cannot race to POST.
  inFlight.add(key);
  try {
    await liveScope(token, staffId, signal);
    if (kind === "room-types") {
      const amenities = rows(readResult(await request("/amenities", token, staffId, signal), token, staffId), "amenities");
      const available = new Set(amenities.map((row) => row.AmenityID));
      if (parsed.amenityIds.some((id) => !available.has(id))) throw failure("The amenity choices have changed. Refresh and choose them again.", 400);
    }
    if (signal?.aborted || currentStaff(token, staffId) === null) throw cancelled();
    if (readPropertyAttempt(kind, staffId)) throw failure("Check the previous property action before adding another item.", 0, true);
    const attempt = { kind, staffId, stage: "pending", id: null, draft: parsed };
    try { persistAttempt(key, attempt); } catch {
      throw failure("Your browser could not save this action for checking later. No item was submitted. Allow session storage before continuing.");
    }
    const { response, data } = await request(`/${kind}`, token, staffId, signal, parsed);
    const savedId = acknowledgement(kind, data, parsed);
    if (response.ok && response.status === 201 && savedId !== null) {
      try { persistAttempt(key, { ...attempt, stage: "saved", id: savedId }); } catch {
        return { id: savedId, ...parsed, storageNotice: "The item was saved, but this browser could not update its saved-action record. Refresh and check the list before continuing." };
      }
      return { id: savedId, ...parsed };
    }
    const rejections = { 400: "Check the required fields. The item was not saved.", 401: expiryMessage, 403: accessMessage };
    if (!response.ok && rejections[response.status]) {
      try { sessionStorage.removeItem(key); } catch { /* Preserve a blocking record if storage cannot be cleared. */ }
      if (response.status === 401) expireCurrent(token, staffId);
      throw failure(rejections[response.status], response.status);
    }
    throw failure(uncertainMessage, response.status, true);
  } finally { inFlight.delete(key); }
}

// The success receipt identifies the creation; only a fresh catalogue supplies its displayed details.
export function propertyAttemptMatchesCatalogue(attempt, catalogue) {
  if (attempt?.stage !== "saved" || !["branches", "room-types"].includes(attempt.kind)
      || !Number.isInteger(attempt.id) || attempt.id <= 0 || !attempt.draft
      || !Array.isArray(catalogue?.rows) || !Array.isArray(catalogue?.amenities)) return false;
  const branch = attempt.kind === "branches";
  const draft = attempt.draft;
  const row = catalogue.rows.find((item) => (branch ? item?.BranchID : item?.RoomTypeID) === attempt.id);
  if (!row || row.Name !== draft.name) return false;
  if (branch) return row.Location === draft.location && row.ContactNumber === draft.contactNumber;
  if (row.Capacity !== draft.capacity || row.DailyRate !== draft.dailyRate
      || !Array.isArray(row.amenities) || !Array.isArray(draft.amenityIds)) return false;
  const names = draft.amenityIds.map((id) => catalogue.amenities.find((item) => item?.AmenityID === id)?.AmenityName);
  return names.every((name) => typeof name === "string" && name.length > 0)
    && JSON.stringify([...row.amenities].sort()) === JSON.stringify([...names].sort());
}
