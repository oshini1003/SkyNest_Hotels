import { useState } from "react";
import { Link, useNavigate } from "react-router";
import "./GuestLogin.css";

export default function GuestLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  function handleLogin(e) {
    e.preventDefault();
    
    if (!email || !password) {
      setError("Please fill in all required fields.");
      return;
    }

    if (email === "lakshan@gmail.com" && password === "123456") {
      setError("");
      alert("Login successful!");
      navigate("/guest/profile");
    } else {
      setError("Invalid email or password. Please try again.");
    }
  }

  return (
    <section className="guest-login-page">
      <header className="guest-login-heading">
        <p className="guest-login-eyebrow">GUEST PORTAL</p>
        <h1>Sign In to Your Account</h1>
      </header>

      <div className="guest-login-panel">
        {error && (
          <div className="guest-login-error" role="alert">
            {error}
          </div>
        )}

        <form className="guest-login-form" onSubmit={handleLogin}>
          <div>
            <label htmlFor="guest-login-email">Email Address</label>
            <input
              id="guest-login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              required
            />
          </div>

          <div>
            <label htmlFor="guest-login-password">Password</label>
            <input
              id="guest-login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
            />
          </div>

          <button type="submit" className="guest-login-submit">
            Sign In
          </button>
        </form>

        <div className="guest-login-register">
          <p>Don't have an account? <Link to="/guest/register">Register here</Link></p>
        </div>
      </div>
    </section>
  );
}