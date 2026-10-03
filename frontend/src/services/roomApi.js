import { API_BASE } from "./session";

const REQUEST_TIMEOUT_MS = 10000;
const unexpectedResponse = "The room service returned an unexpected response. Please try again.";

export function getLocalToday() {
  const date = new Date();
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function calendarDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp
    : null;
}

export function validateStay({ checkin, checkout, guests }) {
  const arrival = calendarDay(checkin);
  const departure = calendarDay(checkout);
  if (arrival === null || departure === null) {
    throw new Error("Please choose valid check-in and check-out dates.");
  }
  if (checkin < getLocalToday()) {
    throw new Error("Check-in cannot be earlier than today.");
  }
  const nights = (departure - arrival) / 86400000;
  if (!Number.isInteger(nights) || nights < 1) {
    throw new Error("Check-out must be after check-in.");
  }
  const guestCount = Number(guests);
  if (!Number.isSafeInteger(guestCount) || guestCount < 1) {
    throw new Error("Enter a whole number of guests, starting from 1.");
  }
  return { checkin, checkout, guests: guestCount, nights };
}

async function publicRequest(path, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
  signal?.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  let response;
  let data;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    data = await response.json();
  } catch (error) {
    if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
    if (timedOut) throw new Error("The room service took too long to respond. Please try again.");
    if (error instanceof SyntaxError) throw new Error(unexpectedResponse);
    throw new Error("The room service is unavailable. Please try again.");
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }

  if (!response.ok) {
    throw new Error(typeof data?.error === "string" ? data.error : "Unable to load rooms. Please try again.");
  }
  if (!Array.isArray(data)) throw new Error(unexpectedResponse);
  return data;
}

function positiveId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error(unexpectedResponse);
  return id;
}

function text(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error(unexpectedResponse);
  return value;
}

export async function loadRoomOptions(signal) {
  const [branches, roomTypes] = await Promise.all([
    publicRequest("/branches", signal),
    publicRequest("/room-types", signal),
  ]);
  return {
    branches: branches.map((branch) => ({ id: positiveId(branch.BranchID), name: text(branch.Name) })),
    roomTypes: roomTypes.map((type) => ({ id: positiveId(type.RoomTypeID), name: text(type.Name) })),
  };
}

export async function searchRooms({ branchId, roomTypeId, roomId, checkin, checkout, guests }, signal) {
  const stay = validateStay({ checkin, checkout, guests });
  const query = new URLSearchParams({
    checkin: stay.checkin,
    checkout: stay.checkout,
    guestCount: String(stay.guests),
  });
  for (const [name, value] of Object.entries({ branchId, roomTypeId, roomId })) {
    if (value !== undefined && value !== "") query.set(name, String(positiveId(value)));
  }
  const rooms = await publicRequest(`/rooms?${query}`, signal);
  return rooms.map((room) => {
    const pricePerNight = Number(room.DailyRate);
    if (room.DailyRate === null || room.DailyRate === "" || !Number.isFinite(pricePerNight) || pricePerNight < 0) {
      throw new Error(unexpectedResponse);
    }
    return {
      id: positiveId(room.RoomID),
      number: text(String(room.RoomNumber ?? "")),
      branchId: positiveId(room.BranchID),
      branch: text(room.BranchName),
      roomTypeId: positiveId(room.RoomTypeID),
      roomType: text(room.RoomTypeName),
      capacity: positiveId(room.Capacity),
      pricePerNight,
    };
  });
}
