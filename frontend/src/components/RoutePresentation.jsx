import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router";

const pageNames = {
  "/": "A thoughtful stay",
  "/branches": "Our branches",
  "/rooms": "Find a room",
  "/services": "Guest services",
  "/make-booking": "Review your booking",
  "/guest": "My account",
  "/guest/profile": "My account",
  "/guest/login": "Guest sign in",
  "/guest/register": "Create a guest account",
  "/guest/bookings": "My bookings",
  "/staff": "Staff workspace",
  "/staff/login": "Staff sign in",
  "/staff/bookings": "Reservations",
  "/staff/dashboard": "Manager dashboard",
  "/staff/reports": "Manager reports",
  "/staff/services": "Service catalogue",
  "/staff/branches": "Manage branches",
  "/staff/room-types": "Manage room types",
  "/staff/rooms": "Manage rooms",
  "/staff/amenities": "Manage amenities",
  "/staff/accounts": "Create a staff account",
};

function pageName(pathname, showPreviews) {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (Object.hasOwn(pageNames, path)) return pageNames[path];
  if (/^\/guest\/bookings\/[^/]+\/bill$/.test(path)) return "My bill and payments";
  if (/^\/guest\/bookings\/[^/]+\/services$/.test(path)) return "Request a service";
  if (/^\/staff\/bookings\/[^/]+\/bill$/.test(path)) return "Billing and checkout";
  if (/^\/staff\/bookings\/[^/]+\/services$/.test(path)) return "Record guest services";
  if (/^\/staff\/bookings\/[^/]+$/.test(path)) return "Reservation details";
  if (showPreviews && path.startsWith("/preview/")) return "Development preview";
  return "Page not found";
}

export default function RoutePresentation({ mainRef, showPreviews }) {
  const { pathname, hash } = useLocation();
  const navigationType = useNavigationType();
  const previousPath = useRef(pathname);

  useEffect(() => {
    // Keep booking references, names and other private values out of tab titles.
    document.title = `${pageName(pathname, showPreviews)} | SkyNest Hotels`;
  }, [pathname, showPreviews]);

  useEffect(() => {
    const changedPage = previousPath.current !== pathname;
    previousPath.current = pathname;
    // Hash links have their own targets. Same-page query/state updates include
    // booking submission guards, so do not move focus or remount their forms.
    if (!changedPage || hash) return;
    mainRef.current?.focus({ preventScroll: true });
    // Leave history Back/Forward scroll restoration to the browser.
    if (navigationType !== "POP") window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname, hash, navigationType, mainRef]);

  return null;
}
