import { useState } from "react";
import { Link, useNavigate } from "react-router";
import "./GuestRegister.css";

export default function GuestRegister() {
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: ""
  });
  const [error, setError] = useState("");
  const navigate = useNavigate();

  function handleRegister(e) {
    e.preventDefault();
    
    if (!formData.fullName || !formData.email || !formData.phone || !formData.password || !formData.confirmPassword) {
      setError("Please fill in all required fields.");
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError("Passwords do not match. Please check again.");
      return;
    }

    setError("");
    alert("Registration successful!");
    navigate("/guest/login");
  }

  return (
    <section className="guest-register-page">
      <header className="guest-register-heading">
        <p className="guest-register-eyebrow">GUEST PORTAL</p>
        <h1>Create Your Account</h1>
      </header>

      <div className="guest-register-panel">
        {error && (
          <div className="guest-register-error" role="alert">
            {error}
          </div>
        )}

        <form className="guest-register-form" onSubmit={handleRegister}>
          <section className="guest-register-group">
            <header className="guest-register-group-heading">
              <p>01 / PERSONAL DETAILS</p>
              <h2>Your details</h2>
            </header>

            <div className="guest-register-fields">
              <div className="guest-register-field">
                <label htmlFor="guest-register-name">Full Name</label>
                <input
                  id="guest-register-name"
                  type="text"
                  value={formData.fullName}
                  onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                  placeholder="Enter your full name"
                  required
                />
              </div>

              <div className="guest-register-field">
                <label htmlFor="guest-register-phone">Phone Number</label>
                <input
                  id="guest-register-phone"
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="Enter your phone number"
                  required
                />
              </div>
            </div>
          </section>

          <section className="guest-register-group">
            <header className="guest-register-group-heading">
              <p>02 / ACCOUNT ACCESS</p>
              <h2>Login credentials</h2>
            </header>

            <div className="guest-register-fields">
              <div className="guest-register-field guest-register-field--wide">
                <label htmlFor="guest-register-email">Email Address</label>
                <input
                  id="guest-register-email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="Enter your email"
                  required
                />
              </div>

              <div className="guest-register-field">
                <label htmlFor="guest-register-password">Password</label>
                <input
                  id="guest-register-password"
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="Create a password"
                  required
                />
              </div>

              <div className="guest-register-field">
                <label htmlFor="guest-register-confirm-password">Confirm Password</label>
                <input
                  id="guest-register-confirm-password"
                  type="password"
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                  placeholder="Confirm your password"
                  required
                />
              </div>
            </div>
          </section>

          <button type="submit" className="guest-register-submit">
            Create Account
          </button>
        </form>

        <div className="guest-register-signin">
          <p>Already have an account? <Link to="/guest/login">Sign In</Link></p>
        </div>
      </div>
    </section>
  );
}