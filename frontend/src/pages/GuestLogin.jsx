import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { loginGuest } from "../services/auth";
import { guestReturnDestination, guestSignInState } from "../services/bookingIntent";
import { readSessionNotice } from "../services/session";
import "./GuestLogin.css";

export default function GuestLogin({ onLogin }) {
  const { state } = useLocation();
  const destination = guestReturnDestination(state);
  const returnState = guestSignInState(destination.pathname, destination.state);
  const active = useRef(true);
  const submitting = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  const [notice] = useState(() => readSessionNotice("guest"));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleLogin(event) {
    event.preventDefault();
    if (submitting.current) return;
    setError("");

    if (!username.trim() || !password) {
      setError("Please enter your username and password.");
      return;
    }
    if (new TextEncoder().encode(password).length > 72) {
      setError("Password must use at most 72 UTF-8 bytes.");
      return;
    }

    submitting.current = true;
    setIsSubmitting(true);
    try {
      const session = await loginGuest(username.trim(), password);
      if (!active.current) return;
      setPassword("");
      onLogin(session);
    } catch (err) {
      if (active.current) setError(err.message || "Unable to sign in.");
    } finally {
      submitting.current = false;
      if (active.current) setIsSubmitting(false);
    }
  }

  return (
    <section className="guest-login-page" aria-labelledby="guest-login-heading">
      <header className="guest-login-heading">
        <p className="guest-login-eyebrow">GUEST PORTAL</p>
        <h1 id="guest-login-heading">Sign In to Your Account</h1>
        <p className="guest-login-intro">
          {destination.pathname === "/make-booking"
            ? "Sign in to continue with your selected stay."
            : "Sign in to manage your hotel stays."}
        </p>
      </header>

      <div className="guest-login-panel">
        {notice && <p className="guest-login-notice" role="status">{notice}</p>}
        {error && (
          <div className="guest-login-error" role="alert">
            {error}
          </div>
        )}

        <form className="guest-login-form" onSubmit={handleLogin} aria-busy={isSubmitting}>
          <div>
            <label htmlFor="guest-login-username">Username</label>
            <input
              id="guest-login-username"
              name="username"
              type="text"
              autoComplete="username"
              maxLength={60}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Enter your username"
              disabled={isSubmitting}
              required
            />
          </div>

          <div>
            <label htmlFor="guest-login-password">Password</label>
            <input
              id="guest-login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              disabled={isSubmitting}
              required
            />
          </div>

          <button type="submit" className="guest-login-submit" disabled={isSubmitting}>
            {isSubmitting ? "Signing in…" : "Sign In"}
          </button>
        </form>

        <div className="guest-login-register">
          <p>Don't have an account? <Link to="/guest/register" state={returnState}>Register here</Link></p>
        </div>
      </div>
    </section>
  );
}
