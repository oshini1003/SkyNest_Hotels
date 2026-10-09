import { validateStay } from "./roomApi";

export const MAX_ROOMS = 10; // the booking API accepts 1 to 10 rooms per booking
const validId = (value) => Number.isSafeInteger(value) && value >= 1 && value <= 2147483647;

// Accepts { checkin, checkout, rooms: [{ roomId, guests }] } and, for older links,
// the single-room { roomId, guests, checkin, checkout } shape. It always returns
// the multi-room shape. Only these non-sensitive stay fields survive the
// sign-in/register journey.
export function selectedStay(value) {
  if (!value || typeof value !== "object") return null;
  const requested = Array.isArray(value.rooms)
    ? value.rooms
    : [{ roomId: value.roomId, guests: value.guests }];
  if (requested.length < 1 || requested.length > MAX_ROOMS) return null;
  const rooms = [];
  for (const entry of requested) {
    if (!entry || !validId(entry.roomId) || !validId(entry.guests)) return null;
    rooms.push({ roomId: entry.roomId, guests: entry.guests });
  }
  if (new Set(rooms.map((room) => room.roomId)).size !== rooms.length) return null;
  try {
    const stay = validateStay({ checkin: value.checkin, checkout: value.checkout, guests: 1 });
    return { checkin: stay.checkin, checkout: stay.checkout, rooms };
  } catch {
    return null;
  }
}

export function guestReturnDestination(state) {
  if (guestStayPath(state?.returnTo)) return { pathname: state.returnTo };
  if (state?.returnTo === "/guest/bookings") return { pathname: "/guest/bookings" };
  const stay = selectedStay(state?.stay);
  if (state?.returnTo === "/make-booking" && stay) {
    return { pathname: "/make-booking", state: { stay } };
  }
  return { pathname: "/guest" };
}

export function guestSignInState(pathname, state) {
  if (guestStayPath(pathname)) return { returnTo: pathname };
  if (pathname === "/guest/bookings" || state?.bookingSubmitted === true) {
    return { returnTo: "/guest/bookings" };
  }
  const stay = selectedStay(state?.stay);
  return pathname === "/make-booking" && stay
    ? { returnTo: "/make-booking", stay }
    : undefined;
}

// Keep only a canonical local bill or service route across sign-in and registration.
function guestStayPath(value) {
  if (typeof value !== "string") return false;
  const match = /^\/guest\/bookings\/([1-9]\d*)\/(?:bill|services)$/.exec(value);
  return Boolean(match && Number(match[1]) <= 2147483647);
}
