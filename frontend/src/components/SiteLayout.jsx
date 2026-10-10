import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { canViewReports } from "../services/reportApi";
import RoutePresentation from "./RoutePresentation";
import "./SiteLayout.css";

function Brand({ to = "/", compact = false }) {
  return (
    <Link className={`sk-brand${compact ? " sk-brand--compact" : ""}`} to={to} aria-label={to === "/staff" ? "SkyNest staff workspace" : "SkyNest Hotels home"}>
      <svg className="sk-brand-mark" viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <path d="M8 28V18L24 8l16 10v20H8v-5" />
        <path d="M15 28c3-7 8-10 17-9-4 2-7 5-9 9h10c-4 5-10 7-18 6" />
        <path d="M20 39h8" />
      </svg>
      <span className="sk-brand-type">SkyNest<span className="sk-brand-subtitle">HOTELS</span></span>
    </Link>
  );
}

function Header({ session, staffSession, staffContext }) {
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef(null);
  const isStaffWorkspace = staffContext && Boolean(staffSession);
  const isPropertyPage = ["/staff/branches", "/staff/room-types", "/staff/rooms", "/staff/amenities"].includes(pathname);

  useEffect(() => {
    if (!menuOpen) return undefined;
    function handleEscape(event) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [menuOpen]);

  function closeOnNavigation(event) {
    if (event.target.closest("a")) setMenuOpen(false);
  }

  return (
    <header className="sk-header">
      <div className="sk-header-inner">
        <div className="sk-header-brand">
          <Brand to={isStaffWorkspace ? "/staff" : "/"} />
          {staffContext && <span className="sk-workspace-label">{isStaffWorkspace ? "Staff workspace" : "Staff access"}</span>}
        </div>

        <button
          ref={menuButton}
          type="button"
          className="sk-menu-toggle"
          aria-expanded={menuOpen}
          aria-controls="skynest-navigation"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            {menuOpen ? <path d="m6 6 12 12M6 18 18 6" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
          {menuOpen ? "Close" : "Menu"}
        </button>

        <nav id="skynest-navigation" className="sk-navigation" aria-label={staffContext ? "Staff navigation" : "Main navigation"} data-open={menuOpen} onClick={closeOnNavigation}>
          {staffContext ? (
            <>
              <Link to="/" className="sk-website-link"><span aria-hidden="true">↗</span> Hotel website</Link>
              {isStaffWorkspace && (
                <>
                  {canViewReports(staffSession.staff.role) && <NavLink to="/staff/dashboard">Dashboard</NavLink>}
                  <NavLink to="/staff/bookings">Bookings</NavLink>
                  {canViewReports(staffSession.staff.role) && <NavLink to="/staff/reports">Reports</NavLink>}
                  {canViewReports(staffSession.staff.role) && <NavLink to="/staff/services">Catalogue</NavLink>}
                  {canViewReports(staffSession.staff.role) && <Link to="/staff/branches" className={isPropertyPage ? "active" : undefined} aria-current={pathname === "/staff/branches" ? "page" : isPropertyPage ? "location" : undefined}>Property</Link>}
                  <NavLink to="/staff" end className="sk-account-link">My account</NavLink>
                </>
              )}
            </>
          ) : (
            <>
              <NavLink to="/" end>Home</NavLink>
              <NavLink to="/branches">Branches</NavLink>
              <NavLink to="/rooms">Rooms</NavLink>
              <NavLink to="/services">Services</NavLink>
              {session && <NavLink to="/guest/bookings">My bookings</NavLink>}
              <NavLink to={session ? "/guest" : "/guest/login"} end className="sk-account-link">
                {session ? "My account" : "Guest login"}
              </NavLink>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

function Footer({ showPreviews }) {
  return (
    <footer className="sk-footer">
      <div className="sk-footer-inner">
        <div className="sk-footer-top">
          <div className="sk-footer-brand">
            <Brand compact />
            <p>Your stay, thoughtfully connected.</p>
          </div>
          <div className="sk-footer-destinations">
            <span className="sk-footer-label">OUR DESTINATIONS</span>
            <p>Colombo <span aria-hidden="true">·</span> Kandy <span aria-hidden="true">·</span> Galle</p>
          </div>
          <nav className="sk-footer-links" aria-label="Footer navigation">
            <Link to="/rooms">Find a room</Link>
            <Link to="/services">Guest services</Link>
            <Link to="/staff">Staff access <span aria-hidden="true">↗</span></Link>
          </nav>
        </div>
        <div className="sk-footer-bottom">
          <p>SkyNest Hotels <span aria-hidden="true">/</span> Sri Lanka</p>
          {showPreviews && (
            <details className="sk-preview-links">
              <summary>Development previews</summary>
              <nav aria-label="Development previews">
                <Link to="/preview/bookings">Sample guest bookings</Link>
                <Link to="/preview/staff/bookings">Staff bookings</Link>
                <Link to="/preview/staff/bookings/DEMO-1002/services">Service usage</Link>
                <Link to="/preview/staff/bill-details">Billing</Link>
                <Link to="/preview/staff/record-payment">Payments</Link>
                <Link to="/preview/staff/manager-reports">Reports</Link>
              </nav>
            </details>
          )}
        </div>
      </div>
    </footer>
  );
}

export default function SiteLayout({ session, staffSession, showPreviews, children }) {
  const location = useLocation();
  const mainRef = useRef(null);
  const staffContext = location.pathname === "/staff" || location.pathname.startsWith("/staff/");
  const isPreview = showPreviews && location.pathname.startsWith("/preview/");
  const publicHotelPage = ["/", "/branches", "/rooms", "/services"].includes(location.pathname);
  // Remount only the header when navigation or session changes close its mobile menu.
  const headerKey = [location.key, location.pathname, session?.token, staffSession?.token].join(":");

  return (
    <div className={`skynest-layout${staffContext ? " skynest-layout--staff" : ""}${publicHotelPage ? " skynest-layout--hotel" : ""}`}>
      <RoutePresentation mainRef={mainRef} showPreviews={showPreviews} />
      <a className="sk-skip-link" href="#skynest-main">Skip to main content</a>
      <Header key={headerKey} session={session} staffSession={staffSession} staffContext={staffContext} />
      {isPreview && <div className="sk-preview-banner"><span>Development preview</span> Sample data for reviewing the interface.</div>}
      <main ref={mainRef} id="skynest-main" className="main-content sk-main" tabIndex={-1}>
        {children}
      </main>
      <Footer showPreviews={showPreviews} />
    </div>
  );
}
