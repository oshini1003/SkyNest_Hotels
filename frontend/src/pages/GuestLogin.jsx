import { useState } from "react";
import { loginGuest } from "../services/auth";
import { Link } from "react-router";

export default function GuestLogin({ onLogin }) {
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
      setPassword("");
      onLogin(session);
    } catch (err) {
      setError(err.message || "Unable to sign in.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="auth-card" aria-labelledby="login-heading">
      <p className="eyebrow">GUEST ACCESS</p>
      <h1 id="login-heading">Guest login</h1>
      <p>Sign in to manage your hotel stays.</p>

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
            <Link to="/guest/register">Create an account</Link>
        </p>
    </section>
  );
}