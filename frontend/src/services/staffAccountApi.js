import { API_BASE, clearSession } from "./session";
import { readStaffSession } from "./staffAuth";

const roles = ["Admin", "Manager", "Receptionist", "ServiceStaff"];
const inFlight = new Set();
const savedReceipts = new Map();
const expiryMessage = "Your session has expired. Please sign in again.";
const accessMessage = "Only an administrator can create staff accounts.";
const loadMessage = "The staff account details could not be loaded. Please refresh.";
const uncertainMessage = "The account creation result is not confirmed. Ask your system administrator to check this username before trying again.";
// Names, usernames and email are single-line fields; passwords are preserved exactly.
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
function validText(value, maximum) {
  return typeof value === "string" && !controls.test(value) && value.trim() !== "" && [...value].length <= maximum;
}
function text(value, maximum, label) {
  if (typeof value !== "string" || controls.test(value) || !validText(value.trim(), maximum)) {
    throw failure(`Enter ${label} using 1 to ${maximum} characters on one line.`, 400);
  }
  return value.trim();
}
export function canCreateStaff(role) { return role === "Admin"; }
export function parseStaffDraft(draft) {
  if (!object(draft)) throw failure("Enter the staff account details.", 400);
  const name = text(draft.name, 100, "a full name");
  const username = text(draft.username, 60, "a username");
  if (!roles.includes(draft.role)) throw failure("Choose a staff role from the list.", 400);
  const branchId = [undefined, null, ""].includes(draft.branchId) ? null : integer(draft.branchId);
  if ((branchId === null && ![undefined, null, ""].includes(draft.branchId)) ||
      (branchId === null && ["Receptionist", "ServiceStaff"].includes(draft.role))) {
    throw failure("Choose an existing branch. Receptionists and service staff need an assigned branch.", 400);
  }
  let email = null;
  if (![undefined, null, ""].includes(draft.email)) {
    if (typeof draft.email !== "string" || controls.test(draft.email)) throw failure("Enter a valid email address or leave it blank.", 400);
    email = draft.email.trim() || null;
    if (email && ([...email].length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      throw failure("Enter a valid email address using at most 150 characters.", 400);
    }
  }
  if (typeof draft.password !== "string" || draft.password.length < 6 || new TextEncoder().encode(draft.password).length > 72) {
    throw failure("Use a password with at least 6 characters and at most 72 UTF-8 bytes.", 400);
  }
  return { branchId, name, role: draft.role, email, username, password: draft.password };
}
function currentStaff(token, staffId) {
  const session = readStaffSession();
  const id = integer(session?.staff?.staffId);
  return Boolean(token) && session?.token === token && id !== null && canCreateStaff(session.staff.role) &&
    (staffId === undefined || staffId === id) ? id : null;
}
function requireAdmin(token) {
  const session = readStaffSession();
  if (!session || session.token !== token || integer(session.staff.staffId) === null) throw failure(expiryMessage, 401);
  if (!canCreateStaff(session.staff.role)) throw failure(accessMessage, 403);
  return integer(session.staff.staffId);
}
function owner(staffId) {
  const session = readStaffSession();
  const id = integer(staffId);
  if (id === null || currentStaff(session?.token, id) === null) throw failure(expiryMessage, 401);
  return id;
}
function expire(token, staffId) {
  if (currentStaff(token, staffId) !== null) {
    try { clearSession("staff", expiryMessage); } catch { /* Keep the request outcome when browser storage fails. */ }
  }
}
async function request(path, token, staffId, signal, draft) {
  const mutation = draft !== undefined;
  if (signal?.aborted || currentStaff(token, staffId) === null) throw cancelled();
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 10000);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: mutation ? "POST" : "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...(mutation ? { "Content-Type": "application/json" } : {}) },
      ...(mutation ? { body: JSON.stringify(draft) } : {}),
      cache: "no-store", redirect: "error", signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (signal?.aborted || currentStaff(token, staffId) === null) throw cancelled(mutation);
    if (controller.signal.aborted) throw failure(mutation ? uncertainMessage : "The request took too long. Please refresh.", 0, mutation);
    return { response, data };
  } catch (error) {
    if (signal?.aborted || currentStaff(token, staffId) === null) throw cancelled(mutation);
    if (error.outcomeUnknown) throw error;
    throw failure(mutation ? uncertainMessage : (controller.signal.aborted ? "The request took too long. Please refresh." : loadMessage), 0, mutation);
  } finally {
    clearTimeout(timer); signal?.removeEventListener("abort", abort);
  }
}
function readResult({ response, data }, token, staffId) {
  if (response.status === 401) { expire(token, staffId); throw failure(expiryMessage, 401); }
  if (!response.ok || response.status !== 200) throw failure(response.status === 403 ? accessMessage : loadMessage, response.status);
  return data;
}
async function liveScope(token, staffId, signal) {
  const data = readResult(await request("/staff/scope", token, staffId, signal), token, staffId);
  const assigned = object(data) && typeof data.branchId === "number" && integer(data.branchId) !== null && validText(data.branchName, 100);
  if (!object(data) || typeof data.staffId !== "number" || data.staffId !== staffId || data.role !== "Admin" ||
      !(assigned || (data.branchId === null && data.branchName === null))) {
    throw failure("Your current administrator access could not be verified. Please sign in again.", 403);
  }
}
async function branches(token, staffId, signal) {
  const data = readResult(await request("/branches", token, staffId, signal), token, staffId);
  if (!Array.isArray(data)) throw failure(loadMessage);
  const seen = new Set();
  return data.map((row) => {
    const id = integer(row?.BranchID);
    if (!object(row) || id === null || seen.has(id) || !validText(row.Name, 100) ||
        !validText(row.Location, 150) || !validText(row.ContactNumber, 20)) throw failure(loadMessage);
    seen.add(id);
    return { BranchID: id, Name: row.Name, Location: row.Location, ContactNumber: row.ContactNumber };
  });
}
export async function loadStaffCreation(token, signal) {
  const staffId = requireAdmin(token);
  await liveScope(token, staffId, signal);
  return { branches: await branches(token, staffId, signal) };
}
function attemptKey(staffId) { return `skynest_staff_creation:${staffId}`; }
function receipt(value) {
  return object(value) && Object.keys(value).length === 4 && typeof value.staffId === "number" && integer(value.staffId) !== null &&
    validText(value.name, 100) && value.name === value.name.trim() && roles.includes(value.role) &&
    validText(value.username, 60) && value.username === value.username.trim();
}
function validAttempt(value) {
  if (!object(value) || !validText(value.username, 60) || value.username !== value.username.trim()) return false;
  return value.stage === "pending" ? Object.keys(value).length === 2 :
    value.stage === "saved" && Object.keys(value).length === 3 && receipt(value.receipt) && value.receipt.username === value.username;
}
export function readStaffCreationAttempt(staffId) {
  const key = attemptKey(owner(staffId));
  if (savedReceipts.has(key)) return structuredClone(savedReceipts.get(key));
  let raw;
  try { raw = sessionStorage.getItem(key); } catch { throw failure("The browser could not read the previous staff creation. Check browser storage before continuing.", 0, true); }
  if (raw === null) return null;
  let value;
  try { value = JSON.parse(raw); } catch { /* Malformed markers must still prevent duplicate submissions. */ }
  if (!validAttempt(value)) throw failure("The previous staff creation could not be verified. Ask your system administrator to check it before continuing.", 0, true);
  return value;
}
export function clearStaffCreationAttempt(staffId, { confirmedNotCreated = false } = {}) {
  const key = attemptKey(owner(staffId));
  if (inFlight.has(key)) throw failure("Please wait for the current account creation to finish.", 0, true);
  const attempt = readStaffCreationAttempt(staffId);
  if (attempt?.stage === "pending" && confirmedNotCreated !== true) throw failure(uncertainMessage, 0, true);
  try {
    sessionStorage.removeItem(key);
    if (sessionStorage.getItem(key) !== null) throw new Error("Marker remains");
  } catch { throw failure("The browser could not clear the previous staff creation. Check browser storage before continuing.", 0, true); }
  savedReceipts.delete(key);
}
function persist(key, value) {
  const raw = JSON.stringify(value);
  sessionStorage.setItem(key, raw);
  if (sessionStorage.getItem(key) !== raw) throw new Error("Marker was not saved");
}
export async function createStaffAccount(draft, token, signal) {
  const parsed = parseStaffDraft(draft);
  const staffId = requireAdmin(token);
  if (signal?.aborted) throw cancelled();
  const key = attemptKey(staffId);
  if (inFlight.has(key) || readStaffCreationAttempt(staffId)) throw failure("Review the previous account creation before creating another account.", 0, true);
  inFlight.add(key);
  try {
    await liveScope(token, staffId, signal);
    const choices = await branches(token, staffId, signal);
    if (parsed.branchId !== null && !choices.some((branch) => branch.BranchID === parsed.branchId)) {
      throw failure("The branch choices have changed. Refresh and select an existing branch.", 400);
    }
    if (signal?.aborted || currentStaff(token, staffId) === null) throw cancelled();
    if (readStaffCreationAttempt(staffId)) throw failure(uncertainMessage, 0, true);
    // This marker contains neither credentials nor personal contact details.
    const pending = { stage: "pending", username: parsed.username };
    try { persist(key, pending); } catch {
      throw failure("The browser could not save a recovery record. No account was submitted. Allow session storage before continuing.");
    }
    const { response, data } = await request("/auth/staff/register", token, staffId, signal, parsed);
    if (response.ok && response.status === 201 && receipt(data) &&
        data.name === parsed.name && data.role === parsed.role && data.username === parsed.username) {
      const saved = { staffId: data.staffId, name: data.name, role: data.role, username: data.username };
      const attempt = { stage: "saved", username: parsed.username, receipt: saved };
      savedReceipts.set(key, attempt);
      try { persist(key, attempt); } catch {
        return { ...saved, storageNotice: "The account was created, but its browser recovery record could not be updated. Keep the staff ID shown here and do not submit this account again." };
      }
      return saved;
    }
    const rejections = { 400: "Check the account details and branch selection. The account was not created.",
      401: expiryMessage, 403: accessMessage, 409: "That username is already taken. Choose another username only when creating a different account." };
    if (!response.ok && rejections[response.status]) {
      try { sessionStorage.removeItem(key); } catch { /* A retained marker continues to block another submission. */ }
      if (response.status === 401) expire(token, staffId);
      throw failure(rejections[response.status], response.status);
    }
    throw failure(uncertainMessage, response.status, true);
  } finally { inFlight.delete(key); }
}
