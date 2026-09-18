import { useState } from "react";
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
import {
  readGuestSession,
  saveGuestSession,
  clearGuestSession,
} from "./services/auth";
import "./App.css";


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

function handleLogin(newSession) {
  saveGuestSession(newSession);
  setSession(newSession);
}

function handleLogout() {
  clearGuestSession();
  setSession(null);
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
              <NavLink to="/services">Services</NavLink>

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

            <Route
              path="/services"
              element={
                <ListingPage
                  title="Guest services"
                  items={[
                    "Room service",
                    "Spa treatments",
                    "Laundry",
                    "Minibar",
                  ]}
                />
              }
            />
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
                  <section className="auth-card">
                    <p className="eyebrow">MY ACCOUNT</p>
                    <h1>Welcome, {session.guest.name}</h1>
                    <p>Username: {session.guest.username}</p>
                    <button
                      className="button"
                      type="button" 
                      onClick={handleLogout}>

                      Sign out
                    </button>
                  </section>
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

            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>

        <footer className="site-footer">
          SkyNest Hotels · Colombo, Kandy and Galle
        </footer>
      </div>
    </BrowserRouter>
  );
}

export default App;