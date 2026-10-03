// Return paths come from browser state, so keep them inside the staff workspace.
export function staffReturnDestination(state) {
  const path = state?.returnTo;
  if (path === "/staff/bookings") return path;
  const match = typeof path === "string" && /^\/staff\/bookings\/([1-9]\d*)(?:\/(?:services|bill))?$/.exec(path);
  if (match && Number(match[1]) <= 2147483647) return path;
  return "/staff";
}

export function staffSignInState(pathname) {
  const returnTo = staffReturnDestination({ returnTo: pathname });
  return returnTo === "/staff" ? undefined : { returnTo };
}
