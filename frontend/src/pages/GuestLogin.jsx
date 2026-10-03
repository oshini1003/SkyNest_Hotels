import { useEffect, useRef, useState } from "react";
import { readSessionNotice } from "../services/session";
import { loginGuest } from "../services/auth";
import { Link, useLocation } from "react-router";
import { guestReturnDestination, guestSignInState } from "../services/bookingIntent";

export default function GuestLogin({ onLogin }) {
  const { state } = useLocation();
  const destination = guestReturnDestination(state);
  const returnState = guestSignInState(destination.pathname, destination.state);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [notice] = useState(() => readSessionNotice("guest"));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();

    if (isSubmitting) return;

    setError("");

    if (!username.trim() || !password) {
      setError("Please enter your username and password.");
      return;
    }

    setIsSubmitting(true);

    try {
      const session = await loginGuest(username.trim(), password);
      if (!active.current) return;
      setPassword("");
      onLogin(session);
    } catch (err) {
      if (active.current) setError(err.message || "Unable to sign in.");
    } finally {
      if (active.current) setIsSubmitting(false);
    }
  }

  return (
    <section className="auth-card" aria-labelledby="login-heading">
      <p className="eyebrow">GUEST ACCESS</p>
      <h1 id="login-heading">Guest login</h1>
      <p>{destination.pathname === "/make-booking" ? "Sign in to continue with your selected stay." : "Sign in to manage your hotel stays."}</p>

      {notice && <p role="status">{notice}</p>}

      <form
        className="auth-form"
        onSubmit={handleSubmit}
        aria-busy={isSubmitting}
      >
        <div className="form-field">
          <label htmlFor="username">Username</label>
          <input
            id="username"
            name="username"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            disabled={isSubmitting}
            required
          />
        </div>

        <div className="form-field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={isSubmitting}
            required
          />
        </div>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <button
          className="button"
          type="submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
        <p className="auth-switch">
            New to SkyNest?{" "}
            <Link to="/guest/register" state={returnState}>Create an account</Link>
        </p>
    </section>
  );
}
