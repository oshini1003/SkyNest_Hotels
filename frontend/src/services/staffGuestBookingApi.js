import { API_BASE, clearSession } from "./session";
import { readStaffSession } from "./staffAuth";
import { loadStaffScope, staffBookingId } from "./staffBookingApi";
import { validateStay } from "./roomApi";
import { MAX_ROOMS, selectedStay } from "./bookingIntent";

const roles = ["Admin", "Manager", "Receptionist"];
const guestWrites = new Set();
const bookingWrites = new Set();
const savedGuests = new Map();
const expiryMessage = "Your session has expired. Please sign in again.";
const accessMessage = "Only receptionists, managers and administrators can create guest bookings.";
const unexpectedMessage = "The booking service returned an unexpected response. Please refresh.";
const uncertainGuest = "The guest creation result is not confirmed. Wait for the request to finish, then search for the guest before creating another record.";
const uncertainBooking = "We could not confirm the booking result. Check the booking list before trying again; it may already have been saved.";
// Single-line identity fields must not include hidden control characters.
// eslint-disable-next-line no-control-regex
const controls = /[\u0000-\u001f\u007f-\u009f]/;
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function failure(message, status = 0, outcomeUnknown = false) { return Object.assign(new Error(message), { status, outcomeUnknown }); }
function cancelled(outcomeUnknown = false) { return Object.assign(new DOMException("Request cancelled or session changed", "AbortError"), { outcomeUnknown }); }
function validText(value, maximum, optional = false) {
  return (optional && (value === undefined || value === null)) ||
    (typeof value === "string" && !controls.test(value) && (optional || value.trim() !== "") && [...value].length <= maximum);
}
function text(value, maximum, label, optional = false) {
  if (optional && [undefined, null, ""].includes(value)) return null;
  if (typeof value !== "string" || !validText(value.trim(), maximum, optional)) throw failure(`Enter ${label} using ${optional ? "at most" : "1 to"} ${maximum} characters.`, 400);
  return value.trim() || null;
}
export function isCurrentStaff(token) { return Boolean(token) && readStaffSession()?.token === token; }
function identity(token) {
  const session = readStaffSession();
  if (!session || session.token !== token || staffBookingId(session.staff?.staffId) === null) throw failure(expiryMessage, 401);
  if (!roles.includes(session.staff.role)) throw failure(accessMessage, 403);
  return staffBookingId(session.staff.staffId);
}
function owner(staffId) {
  const session = readStaffSession();
  if (staffBookingId(staffId) === null || identity(session?.token) !== staffBookingId(staffId)) throw failure(expiryMessage, 401);
  return staffBookingId(staffId);
}
function assertCurrent(token, signal) { if (signal?.aborted || !isCurrentStaff(token)) throw cancelled(); }

async function request(path, token, signal, body) {
  identity(token); assertCurrent(token, signal);
  const mutation = body !== undefined;
  const unknownMessage = path === "/guests" ? uncertainGuest : uncertainBooking;
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
      ...(mutation ? { body: JSON.stringify(body) } : {}),
      cache: "no-store", redirect: "error", signal: controller.signal,
    });
    data = await response.json().catch(() => null);
  } catch {
    if (signal?.aborted || !isCurrentStaff(token)) throw cancelled(mutation);
    throw failure(mutation ? unknownMessage : "The booking service is unavailable. Please try again.", 0, mutation);
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
  if (signal?.aborted || !isCurrentStaff(token)) throw cancelled(mutation);
  if (controller.signal.aborted) throw failure(mutation ? unknownMessage : "The booking service took too long to respond. Please try again.", 0, mutation);
  if (response.status === 401) {
    try { clearSession("staff", expiryMessage); } catch { /* Preserve the HTTP outcome if browser storage fails. */ }
  }
  if (!response.ok) {
    const rejections = {
      400: "Check the guest details, stay dates and guest counts before trying again.",
      401: expiryMessage, 403: "Your current account cannot do this. Check your assigned branch or sign in again.",
      404: path.startsWith("/guests") ? "Guest booking is not available on this server yet. Please contact your administrator." : "The guest or selected room is no longer available.",
      409: path === "/guests" ? "A guest with these details already exists. Search for the guest instead." : "The selected rooms or booking details have changed. Search for rooms again.",
      422: "These details could not be accepted. Check the form before trying again.",
      429: "Too many requests. Please wait before trying again.",
    };
    const known = rejections[response.status];
    throw failure(mutation && !known ? unknownMessage : known || "Unable to load results. Please try again.", response.status, mutation && !known);
  }
  if (response.status !== (mutation ? 201 : 200) || data === null) throw failure(mutation ? unknownMessage : unexpectedMessage, response.status, mutation);
  return data;
}

export async function loadFrontDeskScope(token, signal) {
  identity(token); assertCurrent(token, signal);
  let scope;
  try { scope = await loadStaffScope(token, signal); }
  catch (error) {
    if (signal?.aborted || !isCurrentStaff(token)) {
      if (error?.status === 401 && !signal?.aborted) throw failure(expiryMessage, 401);
      throw cancelled();
    }
    if (error?.name === "AbortError") throw cancelled();
    throw failure(error?.status === 401 ? expiryMessage : "Your current front-desk access could not be verified. Please refresh or sign in again.", error?.status || 0);
  }
  assertCurrent(token, signal);
  if (!roles.includes(scope.role)) throw failure(accessMessage, 403);
  return scope;
}
function options(data, idName) {
  if (!Array.isArray(data)) throw failure(unexpectedMessage);
  const seen = new Set();
  return data.map((row) => {
    const id = staffBookingId(row?.[idName]);
    if (!object(row) || id === null || seen.has(id) || !validText(row.Name, 100)) throw failure(unexpectedMessage);
    seen.add(id);
    return { id, name: row.Name };
  });
}
export async function loadStaffRoomOptions(token, signal) {
  const scope = await loadFrontDeskScope(token, signal);
  const [branchRows, typeRows] = await Promise.all([request("/branches", token, signal), request("/room-types", token, signal)]);
  let branches = options(branchRows, "BranchID");
  const roomTypes = options(typeRows, "RoomTypeID");
  if (scope.role === "Receptionist") {
    branches = branches.filter((branch) => branch.id === scope.branchId);
    if (branches.length !== 1) throw failure("Your assigned branch is no longer available. Please sign in again.", 403);
  }
  assertCurrent(token, signal);
  return { branches, roomTypes, scope };
}
function searchDraft(filters, scope) {
  if (!object(filters) || staffBookingId(filters.guests) === null) throw failure("Enter valid stay dates and a positive whole number of guests.", 400);
  let stay;
  try { stay = validateStay({ ...filters, guests: staffBookingId(filters.guests) }); }
  catch (error) { throw failure(error.message, 400); }
  const parsed = { ...stay };
  for (const key of ["branchId", "roomTypeId", "roomId"]) {
    const value = key === "branchId" && scope.role === "Receptionist" ? scope.branchId : filters[key];
    if ([undefined, null, ""].includes(value)) continue;
    const id = staffBookingId(value);
    if (id === null) throw failure("Choose an existing branch, room type and room.", 400);
    parsed[key] = id;
  }
  return parsed;
}
function normalizedRooms(data, filters) {
  if (!Array.isArray(data)) throw failure(unexpectedMessage);
  const seen = new Set();
  return data.map((row) => {
    if (!object(row)) throw failure(unexpectedMessage);
    const id = staffBookingId(row.RoomID);
    const branchId = staffBookingId(row.BranchID);
    const roomTypeId = staffBookingId(row.RoomTypeID);
    const capacity = staffBookingId(row.Capacity);
    const rate = typeof row.DailyRate === "number" || typeof row.DailyRate === "string" ? String(row.DailyRate) : "";
    if (id === null || branchId === null || roomTypeId === null || capacity === null || seen.has(id) ||
        !["string", "number"].includes(typeof row.RoomNumber) || !validText(String(row.RoomNumber), 10) ||
        !validText(row.BranchName, 100) || !validText(row.RoomTypeName, 50) ||
        !/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(rate) ||
        !["Available", "Occupied"].includes(row.RoomStatus) || capacity < filters.guests ||
        (filters.branchId !== undefined && branchId !== filters.branchId) ||
        (filters.roomTypeId !== undefined && roomTypeId !== filters.roomTypeId) ||
        (filters.roomId !== undefined && id !== filters.roomId)) throw failure(unexpectedMessage);
    seen.add(id);
    return { id, number: String(row.RoomNumber), branchId, branch: row.BranchName,
      roomTypeId, roomType: row.RoomTypeName, capacity, pricePerNight: Number(rate) };
  });
}
async function scopedRooms(filters, scope, token, signal) {
  const draft = searchDraft(filters, scope);
  const query = new URLSearchParams({ checkin: draft.checkin, checkout: draft.checkout, guestCount: String(draft.guests) });
  for (const key of ["branchId", "roomTypeId", "roomId"]) if (draft[key] !== undefined) query.set(key, String(draft[key]));
  return normalizedRooms(await request(`/rooms?${query}`, token, signal), draft);
}
export async function searchStaffRooms(filters, token, signal) {
  const scope = await loadFrontDeskScope(token, signal);
  return { rooms: await scopedRooms(filters, scope, token, signal), scope };
}
export async function loadStaffBookingAvailability(selection, token, signal) {
  const stay = selectedStay(selection);
  if (!stay) throw failure("Choose the guest, rooms and valid stay dates again.", 400);
  const scope = await loadFrontDeskScope(token, signal);
  const results = await Promise.all(stay.rooms.map(({ roomId, guests }) => scopedRooms({ roomId, guests, checkin: stay.checkin, checkout: stay.checkout }, scope, token, signal)));
  const found = stay.rooms.map(({ roomId, guests }, index) => {
    const room = results[index].find((row) => row.id === roomId && row.capacity >= guests);
    return room ? { ...room, guests } : null;
  });
  assertCurrent(token, signal);
  return { rooms: found.filter(Boolean), scope, unavailable: found.filter((room) => room === null).length };
}

export function parseGuestDraft(details) {
  if (!object(details)) throw failure("Enter the guest details.", 400);
  const name = text(details.name, 100, "a full name");
  const contactNumber = text(details.contactNumber, 100, "a contact number").replace(/[\s-]/g, "");
  if (!/^\+?[0-9]{7,15}$/.test(contactNumber)) throw failure("Contact number must contain 7 to 15 digits, optionally starting with +.", 400);
  const email = text(details.email, 150, "an email address", true);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw failure("Enter a valid email address or leave it blank.", 400);
  const idNumber = text(details.idNumber, 30, "a NIC or passport number");
  const address = text(details.address, 255, "an address", true);
  return { name, contactNumber, email, idNumber, address };
}
function guestRecord(row, minimal = false) {
  if (!object(row) || typeof row.GuestID !== "number" || staffBookingId(row.GuestID) === null ||
      !validText(row.Name, 100) || !validText(row.ContactNumber, 20) ||
      (!minimal && (!validText(row.Email, 150, true) || !validText(row.IDNumber, 30, true)))) throw failure(unexpectedMessage);
  const guest = { GuestID: row.GuestID, Name: row.Name, ContactNumber: row.ContactNumber };
  if (!minimal) {
    if (row.Email !== undefined) guest.Email = row.Email;
    if (row.IDNumber !== undefined) guest.IDNumber = row.IDNumber;
  }
  return guest;
}
export async function searchGuests(term, token, signal) {
  if (typeof term !== "string" || controls.test(term) || term.trim().length < 2 || term.trim().length > 100) throw failure("Enter 2 to 100 characters to search for a guest.", 400);
  await loadFrontDeskScope(token, signal);
  const data = await request(`/guests?q=${encodeURIComponent(term.trim())}`, token, signal);
  if (!Array.isArray(data) || data.length > 20) throw failure(unexpectedMessage);
  const rows = data.map((row) => guestRecord(row));
  if (new Set(rows.map((row) => row.GuestID)).size !== rows.length) throw failure(unexpectedMessage);
  return rows;
}
function attemptKey(staffId) { return `skynest_guest_creation:${staffId}`; }
function persist(key, marker) {
  const raw = JSON.stringify(marker);
  sessionStorage.setItem(key, raw);
  if (sessionStorage.getItem(key) !== raw) throw new Error("Recovery record was not saved");
}
export function readGuestCreationAttempt(staffId) {
  const key = attemptKey(owner(staffId));
  if (savedGuests.has(key)) return structuredClone(savedGuests.get(key));
  let value;
  try {
    const raw = sessionStorage.getItem(key);
    if (raw === null) return null;
    value = JSON.parse(raw);
    if (object(value) && value.stage === "pending" && Object.keys(value).length === 1) return value;
    if (object(value) && value.stage === "saved" && Object.keys(value).length === 2 &&
        object(value.guest) && Object.keys(value.guest).length === 3) return { stage: "saved", guest: guestRecord(value.guest, true) };
  } catch { /* Unreadable or malformed records must still prevent repeating a write. */ }
  throw failure("The previous guest creation could not be checked. Search for the guest and ask your administrator before continuing.", 0, true);
}
export function clearGuestCreationAttempt(staffId, { confirmedNotCreated = false } = {}) {
  const key = attemptKey(owner(staffId));
  if (guestWrites.has(key)) throw failure("Wait for the current guest request to finish.", 0, true);
  const attempt = readGuestCreationAttempt(staffId);
  if (attempt?.stage === "pending" && confirmedNotCreated !== true) throw failure(uncertainGuest, 0, true);
  try { sessionStorage.removeItem(key); if (sessionStorage.getItem(key) !== null) throw new Error("Recovery record remains"); }
  catch { throw failure("The browser could not clear the previous guest creation. Please check browser storage.", 0, true); }
  savedGuests.delete(key);
}
export async function createGuest(details, token, signal) {
  const draft = parseGuestDraft(details);
  const staffId = identity(token);
  assertCurrent(token, signal);
  const key = attemptKey(staffId);
  if (guestWrites.has(key) || readGuestCreationAttempt(staffId)) throw failure("Check the previous guest creation before creating another record.", 0, true);
  guestWrites.add(key);
  let marked = false;
  try {
    await loadFrontDeskScope(token, signal);
    assertCurrent(token, signal);
    if (readGuestCreationAttempt(staffId)) throw failure(uncertainGuest, 0, true);
    try { persist(key, { stage: "pending" }); marked = true; }
    catch { throw failure("The browser could not save a recovery record. No guest was submitted. Allow session storage before continuing."); }
    const data = await request("/guests", token, signal, draft);
    let guest;
    try { guest = guestRecord(data?.guest); }
    catch { throw failure(uncertainGuest, 0, true); }
    if (guest.Name !== draft.name || guest.ContactNumber !== draft.contactNumber ||
        (guest.Email !== undefined && guest.Email !== draft.email) || (guest.IDNumber !== undefined && guest.IDNumber !== draft.idNumber)) throw failure(uncertainGuest, 0, true);
    const saved = { stage: "saved", guest: guestRecord(guest, true) };
    savedGuests.set(key, saved);
    try { persist(key, saved); } catch { /* A known acknowledgement stays successful even if only the pending record survives a reload. */ }
    return guest;
  } catch (error) {
    if (marked && error.outcomeUnknown !== true) {
      try { sessionStorage.removeItem(key); } catch { /* Retained pending records still block another write. */ }
    }
    throw error;
  } finally { guestWrites.delete(key); }
}
function bookingDraft(details) {
  if (!object(details)) throw failure("Choose a guest, rooms and stay dates.", 400);
  const multi = Object.hasOwn(details, "rooms");
  const allowed = multi ? ["guestId", "checkin", "checkout", "paymentMethod", "rooms"] : ["guestId", "checkin", "checkout", "paymentMethod", "roomId", "guestCount"];
  if (Object.keys(details).some((key) => !allowed.includes(key)) || staffBookingId(details.guestId) === null ||
      !["Cash", "Card", "Bank Transfer"].includes(details.paymentMethod)) throw failure("Check the guest, room selection and payment preference.", 400);
  const entries = multi ? details.rooms : [{ roomId: details.roomId, guestCount: details.guestCount }];
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > MAX_ROOMS || entries.some((row) => !object(row) ||
      Object.keys(row).some((key) => !["roomId", "guestCount"].includes(key)) || staffBookingId(row.roomId) === null || staffBookingId(row.guestCount) === null)) throw failure(`Choose between 1 and ${MAX_ROOMS} rooms with valid guest counts.`, 400);
  const rooms = entries.map((row) => ({ roomId: staffBookingId(row.roomId), guests: staffBookingId(row.guestCount) }));
  const stay = selectedStay({ checkin: details.checkin, checkout: details.checkout, rooms });
  if (!stay) throw failure("Choose distinct rooms and valid stay dates.", 400);
  const body = { guestId: staffBookingId(details.guestId), checkin: stay.checkin, checkout: stay.checkout, paymentMethod: details.paymentMethod };
  if (multi) body.rooms = rooms.map(({ roomId, guests }) => ({ roomId, guestCount: guests }));
  else Object.assign(body, { roomId: rooms[0].roomId, guestCount: rooms[0].guests });
  return { body, stay };
}
export async function createStaffBooking(details, token, signal) {
  const { body, stay } = bookingDraft(details);
  const staffId = identity(token);
  assertCurrent(token, signal);
  if (bookingWrites.has(staffId)) throw failure("Wait for the current booking request to finish.", 0, true);
  bookingWrites.add(staffId);
  try {
    const available = await loadStaffBookingAvailability(stay, token, signal);
    if (available.unavailable || available.rooms.length !== stay.rooms.length) throw failure("One or more selected rooms are no longer available. Search for rooms again.", 409);
    const data = await request("/bookings", token, signal, body);
    if (!object(data) || typeof data.bookingId !== "number" || staffBookingId(data.bookingId) === null || data.status !== "Booked" ||
        (Object.hasOwn(body, "rooms") && data.rooms !== body.rooms.length)) throw failure(uncertainBooking, 0, true);
    return { bookingId: data.bookingId, status: "Booked" };
  } finally { bookingWrites.delete(staffId); }
}
