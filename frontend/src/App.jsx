import { useEffect, useState } from "react";
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router";
import { guestReturnDestination, guestSignInState } from "./services/bookingIntent";
import { staffReturnDestination, staffSignInState } from "./services/staffIntent";

import {
  readStaffSession,
  saveStaffSession,
} from "./services/staffAuth";

import {
  readGuestSession,
  saveGuestSession,
} from "./services/auth";
import {
  SESSION_CHANGED_EVENT,
  observeSessionExpiry,
  logoutSession,
} from "./services/session";
import "./App.css";
import SiteLayout from "./components/SiteLayout";
import Home from "./pages/Home";

import { lazyPage } from "./components/lazyPage";
import PageBoundary from "./components/PageBoundary";

const GuestLogin = lazyPage(() => import("./pages/GuestLogin"));
const GuestRegister = lazyPage(() => import("./pages/GuestRegister"));
const RoomSearch = lazyPage(() => import("./pages/RoomSearch"));
const MakeBooking = lazyPage(() => import("./pages/MakeBooking"));
const MyBookings = lazyPage(() => import("./pages/MyBookings"));
const GuestBill = lazyPage(() => import("./pages/GuestBill"));
const GuestServices = lazyPage(() => import("./pages/GuestServices"));
const ServiceCatalogue = lazyPage(() => import("./pages/ServiceCatalogue"));
const GuestProfile = lazyPage(() => import("./pages/GuestProfile"));
const StaffLogin = lazyPage(() => import("./pages/StaffLogin"));
const StaffHome = lazyPage(() => import("./pages/StaffHome"));
const StaffBookingList = lazyPage(() => import("./pages/StaffBookingList"));
const StaffBookingDetails = lazyPage(() => import("./pages/StaffBookingDetails"));
const StaffServiceUsage = lazyPage(() => import("./pages/StaffServiceUsage"));
const StaffBilling = lazyPage(() => import("./pages/StaffBilling"));
const ManagerReports = lazyPage(() => import("./pages/ManagerReports"));
const ManagerDashboard = lazyPage(() => import("./pages/ManagerDashboard"));
const Branches = lazyPage(() => import("./pages/Branches"));

const showPreviews = import.meta.env.DEV;
// This import is reachable only in development; sample pages/data stay out of production.
const previewPage = (name) => lazyPage(() => import("./pages/DevelopmentPreviews")
  .then((pages) => ({ default: pages[name] })));
const previews = showPreviews ? {
  GuestBookings: previewPage("GuestBookingsPreview"),
  StaffBookings: previewPage("StaffBookingsPreview"),
  ServiceUsage: previewPage("ServiceUsagePreview"),
  BillDetails: previewPage("StaffBillDetails"),
  Payment: previewPage("StaffPayment"),
  Reports: previewPage("ManagerReportsPreview"),
} : null;

function NotFound() {
  return (
    <section>
      <h1>Page not found</h1>
      <p>The page you requested does not exist.</p>
      <Link className="button" to="/">
        Return home
      </Link>
    </section>
  );
}

function SignedInGuestRedirect() {
  const { state } = useLocation();
  const destination = guestReturnDestination(state);
  return <Navigate to={destination.pathname} state={destination.state} replace />;
}

function GuestOnly({ session, children }) {
  const { pathname, state } = useLocation();
  return session ? children : <Navigate to="/guest/login" state={guestSignInState(pathname, state)} replace />;
}

function SignedInStaffRedirect() {
  const { state } = useLocation();
  return <Navigate to={staffReturnDestination(state)} replace />;
}

function StaffOnly({ session, children }) {
  const { pathname } = useLocation();
  return session ? children : <Navigate to="/staff/login" state={staffSignInState(pathname)} replace />;
}

function App() {

const [session, setSession] = useState(readGuestSession);
const [staffSession, setStaffSession] =
  useState(readStaffSession);

useEffect(() => {
  const syncSessions = () => {
    setSession(readGuestSession());
    setStaffSession(readStaffSession());
  };
  window.addEventListener(SESSION_CHANGED_EVENT, syncSessions);
  const stopObserving = observeSessionExpiry();
  syncSessions();
  return () => {
    window.removeEventListener(SESSION_CHANGED_EVENT, syncSessions);
    stopObserving();
  };
}, []);

function handleLogin(newSession) {
  saveGuestSession(newSession);
  setSession(newSession);
}

function handleLogout() {
  void logoutSession("guest");
  setSession(null);
}

function handleStaffLogin(newSession) {
  saveStaffSession(newSession);
  setStaffSession(newSession);
}

function handleStaffLogout() {
  void logoutSession("staff");
  setStaffSession(null);
}

  return (
    <BrowserRouter>
      <SiteLayout session={session} staffSession={staffSession} showPreviews={showPreviews}>
        <PageBoundary guestToken={session?.token} staffToken={staffSession?.token}>
          <Routes>
            <Route path="/" element={<Home />} />

            <Route path="/branches" element={<Branches />} />

            <Route path="/services" element={<ServiceCatalogue />} />
            {showPreviews && (
              <>
                <Route
                  path="/preview/bookings"
                  element={
                    <previews.GuestBookings />
                  }
                />

                <Route
                  path="/preview/staff/bookings"
                  element={
                    <previews.StaffBookings />
                  }
                />
                
                <Route
                  path="/preview/staff/bookings/:bookingReference/services"
                  element={<previews.ServiceUsage />}
                />
                <Route path="/preview/staff/bill-details" element={<previews.BillDetails />} />
                <Route path="/preview/staff/record-payment" element={<previews.Payment />} />
                <Route path="/preview/staff/manager-reports" element={<previews.Reports />} />
              </>
            )}

            <Route
              path="/guest/login"
              element={
                session ? (
                  <SignedInGuestRedirect />
                ) : (
                  <GuestLogin onLogin={handleLogin} />
                )
              }
            />


            <Route
              path="/guest"
              element={
                session ? (
                  <GuestProfile
                    key={session.token}
                    session={session}
                    onLogout={handleLogout}
                    onProfileUpdate={(newName) => {
                      const updated = {
                        ...session,
                        guest: { ...session.guest, name: newName },
                      };
                      saveGuestSession(updated);
                      setSession(updated);
                    }}
                  />
                ) : (
                  <Navigate to="/guest/login" replace />
                )
              }
            />

            <Route
              path="/guest/register"
              element={
                session ? (
                  <SignedInGuestRedirect />
                ) : (
                  <GuestRegister onLogin={handleLogin} />
                )
              }
            />

            <Route path="/rooms" element={<RoomSearch />} />
            <Route
              path="/make-booking"
              element={<GuestOnly session={session}><MakeBooking session={session} /></GuestOnly>}
            />
            <Route
              path="/guest/bookings"
              element={<GuestOnly session={session}><MyBookings key={session?.token} session={session} /></GuestOnly>}
            />
            <Route path="/guest/profile" element={<Navigate to="/guest" replace />} />
            <Route
              path="/guest/bookings/:id/bill"
              element={<GuestOnly session={session}><GuestBill key={session?.token} session={session} /></GuestOnly>}
            />
            <Route
              path="/guest/bookings/:id/services"
              element={<GuestOnly session={session}><GuestServices key={session?.token} session={session} /></GuestOnly>}
            />
            <Route
              path="/staff/login"
              element={
                staffSession ? (
                  <SignedInStaffRedirect />
                ) : (
                  <StaffLogin onLogin={handleStaffLogin} />
                )
              }
            />

            <Route
              path="/staff"
              element={
                staffSession ? (
                  <StaffHome
                    key={staffSession.token}
                    staff={staffSession.staff}
                    onLogout={handleStaffLogout}
                  />
                ) : (
                  <Navigate to="/staff/login" replace />
                )
              }
            />

            <Route
              path="/staff/dashboard"
              element={<StaffOnly session={staffSession}><ManagerDashboard key={staffSession?.token} session={staffSession} /></StaffOnly>}
            />
            <Route
              path="/staff/reports"
              element={<StaffOnly session={staffSession}><ManagerReports key={staffSession?.token} session={staffSession} /></StaffOnly>}
            />
            <Route
              path="/staff/bookings"
              element={<StaffOnly session={staffSession}><StaffBookingList key={staffSession?.token} session={staffSession} /></StaffOnly>}
            />
            <Route
              path="/staff/bookings/:id"
              element={<StaffOnly session={staffSession}><StaffBookingDetails key={staffSession?.token} session={staffSession} /></StaffOnly>}
            />
            <Route
              path="/staff/bookings/:id/services"
              element={<StaffOnly session={staffSession}><StaffServiceUsage key={staffSession?.token} session={staffSession} /></StaffOnly>}
            />
            <Route
              path="/staff/bookings/:id/bill"
              element={<StaffOnly session={staffSession}><StaffBilling key={staffSession?.token} session={staffSession} /></StaffOnly>}
            />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </PageBoundary>
      </SiteLayout>
    </BrowserRouter>
  );
}

export default App;
