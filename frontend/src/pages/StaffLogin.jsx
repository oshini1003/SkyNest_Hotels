import { useState } from "react";
import { Link } from "react-router";
import { loginStaff } from "../services/staffAuth";

export default function StaffLogin({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    setError("");

    const cleanedUsername = username.trim();

    if (!cleanedUsername) {
      setError("Please enter your staff username.");
      return;
    }

    setIsSubmitting(true);

    try {
      const session = await loginStaff(
        cleanedUsername,
        password
      );

      onLogin(session);
      setPassword("");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Unable to sign in. Please try again."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section
      className="auth-card"
      aria-labelledby="staff-login-heading"
    >
      <p className="eyebrow">STAFF ACCESS</p>

      <h1 id="staff-login-heading">Staff login</h1>

      <p>Sign in with your hotel staff account.</p>

      <form
        className="auth-form"
        onSubmit={handleSubmit}
        aria-busy={isSubmitting}
      >
        <div className="form-field">
          <label htmlFor="staff-username">
            Username
          </label>

          <input
            id="staff-username"
            name="username"
            type="text"
            autoComplete="username"
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

        <div className="form-field">
          <label htmlFor="staff-password">
            Password
          </label>

          <input
            id="staff-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            disabled={isSubmitting}
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              setError("");
            }}
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
        Staying with us?{" "}
        <Link to="/guest/login">Guest login</Link>
      </p>
    </section>
  );
}
