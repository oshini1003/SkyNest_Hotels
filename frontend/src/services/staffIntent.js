// Return paths come from browser state, so keep them inside the staff workspace.
export function staffReturnDestination(state) {
  const path = state?.returnTo;
  // A new sign-in starts guest selection again; never retain guest details in
  // sign-in state or resume a possibly submitted booking.
  if (["/staff/bookings/new", "/staff/bookings/rooms", "/staff/make-booking"].includes(path)) return "/staff/bookings/new";
  if (["/staff/bookings", "/staff/reports", "/staff/dashboard", "/staff/services", "/staff/branches", "/staff/room-types", "/staff/rooms", "/staff/amenities", "/staff/accounts"].includes(path)) return path;
  const match = typeof path === "string" && /^\/staff\/bookings\/([1-9]\d*)(?:\/(?:services|bill))?$/.exec(path);
  if (match && Number(match[1]) <= 2147483647) return path;
  return "/staff";
}

export function staffSignInState(pathname) {
  const returnTo = staffReturnDestination({ returnTo: pathname });
  return returnTo === "/staff" ? undefined : { returnTo };
}
