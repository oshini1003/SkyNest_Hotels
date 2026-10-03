import { useEffect, useState } from "react";
import {
  BrowserRouter,
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
} from "react-router";
import GuestLogin from "./pages/GuestLogin";
import GuestRegister from "./pages/GuestRegister";
import RoomSearch from "./pages/RoomSearch";
import MakeBooking from "./pages/MakeBooking"; 
import ServiceCatalogue from "./pages/ServiceCatalogue";
import GuestBookings from "./pages/GuestBookings";
import GuestProfile from "./pages/GuestProfile";
import { demoBookings } from "./data/demoBookings";
import StaffLogin from "./pages/StaffLogin";
import StaffHome from "./pages/StaffHome";
import StaffBookings from "./pages/StaffBookings";
import StaffBillDetails from "./pages/StaffBillDetails";
import StaffPayment from "./pages/StaffPayment";
import ManagerReports from "./pages/ManagerReports";
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

const showPreviews = import.meta.env.DEV;
function Home() {
  return (
    <section className="hero">
      <p className="eyebrow">COLOMBO · KANDY · GALLE</p>
      <h1>Welcome to SkyNest Hotels</h1>
      <p className="hero-description">
        Explore our hotels across Sri Lanka and discover the services
        available during your stay.
      </p>
      <Link className="button" to="/branches">
        Explore our branches
      </Link>
    </section>
  );
}

function ListingPage({ title, items }) {
  return (
    <section>
      <p className="eyebrow">SKYNEST HOTELS</p>
      <h1>{title}</h1>

      <div className="card-grid">
        {items.map((item) => (
          <article className="card" key={item}>
            <h2>{item}</h2>
          </article>
        ))}
      </div>
    </section>
  );
}

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
      <div className="site-shell">
        <header className="site-header">
          <div className="container navbar">
            <Link className="brand" to="/">
              SkyNest <span>HOTELS</span>
            </Link>

            <nav aria-label="Main navigation">
              <NavLink to="/" end>
                Home
              </NavLink>
              <NavLink to="/branches">Branches</NavLink>
              <NavLink to="/rooms">Rooms</NavLink>
              <NavLink to="/services">Services</NavLink>
              {showPreviews && (
                <NavLink to="/preview/bookings">
                  Booking preview
                </NavLink>
              )}

              <NavLink to={session ? "/guest" : "/guest/login"}>
                {session ? "My Account" : "Guest Login"}
              </NavLink>
            </nav>
          </div>
        </header>

        <main className="container main-content">
          <Routes>
            <Route path="/" element={<Home />} />

            <Route
              path="/branches"
              element={
                <ListingPage
                  title="Our branches"
                  items={["Colombo", "Kandy", "Galle"]}
                />
              }
            />

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
                <Route path="/preview/staff/manager-reports" element={<ManagerReports />} />
              </>
            )}

            <Route
              path="/guest/login"
              element={
                session ? (
                  <Navigate to="/guest" replace />
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
                  <Navigate to="/guest" replace />
                ) : (
                  <GuestRegister onLogin={handleLogin} />
                )
              }
            />

            <Route path="/rooms" element={<RoomSearch />} />
            <Route path="/make-booking" element={<MakeBooking />} /> 
            <Route
              path="/staff/login"
              element={
                staffSession ? (
                  <Navigate to="/staff" replace />
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
                    staff={staffSession.staff}
                    onLogout={handleStaffLogout}
                  />
                ) : (
                  <Navigate to="/staff/login" replace />
                )
              }
            />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>

        <footer className="site-footer">
          <p>
            SkyNest Hotels · Colombo, Kandy and Galle
          </p>

          <div className="footer-links">
            <Link className="staff-entry-link" to="/staff">
              Staff access
            </Link>

            {showPreviews && (
              <>
              <Link
                className="staff-entry-link"
                to="/preview/staff/bookings"
              >
                Staff booking preview
              </Link>
              <Link className="staff-entry-link" to="/preview/staff/bill-details">
                Billing preview
              </Link>
              <Link className="staff-entry-link" to="/preview/staff/manager-reports">
                Reports preview
              </Link>
              </>
            )}
          </div>
        </footer>
      </div>
    </BrowserRouter>
  );
}

export default App;
