import { useEffect, useState } from "react";
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router";
import GuestLogin from "./pages/GuestLogin";
import GuestRegister from "./pages/GuestRegister";
import RoomSearch from "./pages/RoomSearch";
import MakeBooking from "./pages/MakeBooking";
import MyBookings from "./pages/MyBookings";
import { guestReturnDestination, guestSignInState } from "./services/bookingIntent";
import ServiceCatalogue from "./pages/ServiceCatalogue";
import GuestBookings from "./pages/GuestBookings";
import GuestProfile from "./pages/GuestProfile";
import { demoBookings } from "./data/demoBookings";
import StaffLogin from "./pages/StaffLogin";
import StaffHome from "./pages/StaffHome";
import StaffBookingList from "./pages/StaffBookingList";
import StaffBookingDetails from "./pages/StaffBookingDetails";
import StaffServiceUsage from "./pages/StaffServiceUsage";
import StaffBilling from "./pages/StaffBilling";
import { staffReturnDestination, staffSignInState } from "./services/staffIntent";
import StaffBookings from "./pages/StaffBookings";
import StaffBillDetails from "./pages/StaffBillDetails";
import StaffPayment from "./pages/StaffPayment";
import ManagerReports from "./pages/ManagerReports";
import ManagerDashboard from "./pages/ManagerDashboard";
import ManagerReportsPreview from "./pages/ManagerReportsPreview";
import { demoStaffBookings } from "./data/demoStaffBookings";
import ServiceUsagePreview from "./pages/ServiceUsagePreview";

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
import Branches from "./pages/Branches";

const showPreviews = import.meta.env.DEV;
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
          <Routes>
            <Route path="/" element={<Home />} />

            <Route path="/branches" element={<Branches />} />

            <Route path="/services" element={<ServiceCatalogue />} />
            {showPreviews && (
              <>
                <Route
                  path="/preview/bookings"
                  element={
                    <GuestBookings
                      bookings={demoBookings}
                      isPreview={true}
                    />
                  }
                />

                <Route
                  path="/preview/staff/bookings"
                  element={
                    <StaffBookings
                      bookings={demoStaffBookings}
                      isPreview={true}
                    />
                  }
                />
                
                <Route
                  path="/preview/staff/bookings/:bookingReference/services"
                  element={<ServiceUsagePreview />}
                />
                <Route path="/preview/staff/bill-details" element={<StaffBillDetails />} />
                <Route path="/preview/staff/record-payment" element={<StaffPayment />} />
                <Route path="/preview/staff/manager-reports" element={<ManagerReportsPreview />} />
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
      </SiteLayout>
    </BrowserRouter>
  );
}

export default App;
