import { validateStay } from "./roomApi";

// Only these non-sensitive stay fields survive the sign-in/register journey.
export function selectedStay(value) {
  if (!value || !Number.isSafeInteger(value.roomId) || value.roomId < 1 || value.roomId > 2147483647 ||
      !Number.isSafeInteger(value.guests) || value.guests < 1 || value.guests > 2147483647) return null;
  try {
    const stay = validateStay(value);
    return { roomId: value.roomId, checkin: stay.checkin, checkout: stay.checkout, guests: stay.guests };
  } catch {
    return null;
  }
}

export function guestReturnDestination(state) {
  if (state?.returnTo === "/guest/bookings") return { pathname: "/guest/bookings" };
  const stay = selectedStay(state?.stay);
  if (state?.returnTo === "/make-booking" && stay) {
    return { pathname: "/make-booking", state: { stay } };
  }
  return { pathname: "/guest" };
}

export function guestSignInState(pathname, state) {
  if (pathname === "/guest/bookings" || state?.bookingSubmitted === true) {
    return { returnTo: "/guest/bookings" };
  }
  const stay = selectedStay(state?.stay);
  return pathname === "/make-booking" && stay
    ? { returnTo: "/make-booking", stay }
    : undefined;
}
