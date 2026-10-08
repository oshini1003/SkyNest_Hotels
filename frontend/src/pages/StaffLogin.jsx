import { useEffect, useRef, useState } from "react";
import { readSessionNotice } from "../services/session";
import { Link, useLocation } from "react-router";
import { loginStaff } from "../services/staffAuth";
import { staffReturnDestination } from "../services/staffIntent";
import "./StaffLogin.css";

export default function StaffLogin({ onLogin }) {
  const { state } = useLocation();
  const destination = staffReturnDestination(state);
  const active = useRef(true);
  const busy = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [notice] = useState(() => readSessionNotice("staff"));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();

    if (busy.current) {
      return;
    }

    setError("");

    const cleanedUsername = username.trim();

    if (!cleanedUsername) {
      setError("Please enter your staff username.");
      return;
    }

    busy.current = true;
    setIsSubmitting(true);

    try {
      const session = await loginStaff(
        cleanedUsername,
        password
      );

      if (!active.current) return;
      setPassword("");
      onLogin(session);
    } catch (error) {
      if (active.current) setError(
        error instanceof Error
          ? error.message
          : "Unable to sign in. Please try again."
      );
    } finally {
      busy.current = false;
      if (active.current) setIsSubmitting(false);
    }
  }

  return (
    <section className="staff-login-page" aria-labelledby="staff-login-heading">
      <div className="staff-login-frame">
        <aside className="staff-login-welcome" aria-label="SkyNest team workspace">
          <img src="/images/hotel/hero.jpg" alt="" className="staff-login-photo" />
          <div className="staff-login-welcome-copy">
            <p className="staff-login-kicker">THE SKY NEST TEAM</p>
            <h2>A warm welcome<br />starts with you.</h2>
            <p>Your daily workspace for reservations, guest services and hotel operations.</p>
            <span className="staff-login-locations">Colombo <span aria-hidden="true">·</span> Kandy <span aria-hidden="true">·</span> Galle</span>
          </div>
        </aside>

        <div className="staff-login-panel">
          <header className="staff-login-heading">
            <p className="staff-login-kicker">STAFF ACCESS</p>
            <h1 id="staff-login-heading">Staff login</h1>
            <p>{destination === "/staff" ? "Welcome back. Sign in with your hotel staff account." : "Sign in with your staff account to continue to the requested staff page."}</p>
          </header>

          {notice && <p className="staff-login-notice" role="status">{notice}</p>}

          <form className="staff-login-form" onSubmit={handleSubmit} aria-busy={isSubmitting}>
            <div className="staff-login-field">
              <label htmlFor="staff-username">Username</label>
              <input
                id="staff-username"
                name="username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={60}
                required
                disabled={isSubmitting}
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value);
                  setError("");
                }}
              />
            </div>

            <div className="staff-login-field">
              <label htmlFor="staff-password">Password</label>
              <div className="staff-login-password">
                <input
                  id="staff-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  disabled={isSubmitting}
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setError("");
                  }}
                />
                <button
                  className="staff-login-password-toggle"
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-controls="staff-password"
                  disabled={isSubmitting}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            {error && <p className="staff-login-error" role="alert">{error}</p>}

            <button className="staff-login-submit" type="submit" disabled={isSubmitting}>
              <span>{isSubmitting ? "Signing in…" : "Sign in"}</span>
              <span aria-hidden="true">→</span>
            </button>
          </form>

          <p className="staff-login-help">Need help accessing your account? Contact your hotel administrator.</p>
          <p className="staff-login-guest">Staying with us? <Link to="/guest/login">Guest login <span aria-hidden="true">↗</span></Link></p>
        </div>
      </div>
    </section>
  );
}
