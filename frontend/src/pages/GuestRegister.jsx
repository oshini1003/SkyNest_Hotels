import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { registerGuest } from "../services/auth";
import { guestReturnDestination, guestSignInState } from "../services/bookingIntent";
import "./GuestRegister.css";

const initialForm = {
  name: "",
  contactNumber: "",
  email: "",
  idNumber: "",
  address: "",
  username: "",
  password: "",
  confirmPassword: "",
};

const personalFields = [
  { name: "name", label: "Full Name", type: "text", autoComplete: "name", maxLength: 100 },
  { name: "contactNumber", label: "Contact Number", type: "tel", autoComplete: "tel", maxLength: 20 },
  { name: "email", label: "Email Address (optional)", type: "email", autoComplete: "email", maxLength: 150, optional: true },
  { name: "idNumber", label: "NIC / Passport Number", type: "text", autoComplete: "off", maxLength: 30 },
  { name: "address", label: "Address (optional)", type: "text", autoComplete: "street-address", maxLength: 255, optional: true, wide: true },
];
const accountFields = [
  { name: "username", label: "Username", type: "text", autoComplete: "username", maxLength: 60, wide: true },
  { name: "password", label: "Password", type: "password", autoComplete: "new-password", minLength: 6 },
  { name: "confirmPassword", label: "Confirm Password", type: "password", autoComplete: "new-password", minLength: 6 },
];

export default function GuestRegister({ onLogin }) {
  const { state } = useLocation();
  const destination = guestReturnDestination(state);
  const returnState = guestSignInState(destination.pathname, destination.state);
  const active = useRef(true);
  const submitting = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleChange(event) {
    const { name, value } = event.target;
    if (name === "contactNumber" && !/^\+?[0-9 -]*$/.test(value)) {
      setError("Contact number can contain digits, spaces, hyphens, and an optional + at the start.");
      return;
    }
    setError("");
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function handleRegister(event) {
    event.preventDefault();
    if (submitting.current) return;
    setError("");

    const details = {
      name: form.name.trim(),
      contactNumber: form.contactNumber.trim().replace(/[ -]/g, ""),
      email: form.email.trim(),
      idNumber: form.idNumber.trim(),
      address: form.address.trim(),
      username: form.username.trim(),
      password: form.password,
    };
    if (!details.name || !details.contactNumber || !details.idNumber || !details.username || !details.password) {
      setError("Please complete all required fields.");
      return;
    }
    if (!/^\+?[0-9]{7,15}$/.test(details.contactNumber)) {
      setError("Enter a contact number with 7–15 digits, for example 0712345678 or +94712345678.");
      return;
    }
    if (details.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email)) {
      setError("Enter a valid email address, or leave the optional email field empty.");
      return;
    }
    if (form.password.length < 6 || new TextEncoder().encode(form.password).length > 72) {
      setError("Password must have at least 6 characters and use at most 72 UTF-8 bytes.");
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError("Your passwords do not match.");
      return;
    }

    submitting.current = true;
    setIsSubmitting(true);
    try {
      const session = await registerGuest(details);
      if (active.current) onLogin(session);
    } catch (err) {
      if (active.current) setError(err.message || "Unable to create your account.");
    } finally {
      submitting.current = false;
      if (active.current) setIsSubmitting(false);
    }
  }

  function renderField(field) {
    return (
      <div className={`guest-register-field${field.wide ? " guest-register-field--wide" : ""}`} key={field.name}>
        <label htmlFor={`guest-register-${field.name}`}>{field.label}</label>
        <input
          id={`guest-register-${field.name}`}
          name={field.name}
          type={field.type}
          autoComplete={field.autoComplete}
          maxLength={field.maxLength}
          minLength={field.minLength}
          value={form[field.name]}
          onChange={handleChange}
          disabled={isSubmitting}
          required={!field.optional}
          aria-describedby={field.name === "contactNumber" ? "guest-register-phone-help" : field.name === "password" ? "guest-register-password-help" : undefined}
        />
        {field.name === "contactNumber" && <small id="guest-register-phone-help">7–15 digits; spaces, hyphens and a leading + are accepted.</small>}
        {field.name === "password" && <small id="guest-register-password-help">At least 6 characters.</small>}
      </div>
    );
  }

  return (
    <section className="guest-register-page" aria-labelledby="guest-register-heading">
      <header className="guest-register-heading">
        <p className="guest-register-eyebrow">GUEST PORTAL</p>
        <h1 id="guest-register-heading">Create Your Account</h1>
        <p className="guest-register-intro">
          {destination.pathname === "/make-booking"
            ? "Create an account to continue with your selected stay."
            : "Enter your details to get started with SkyNest Hotels."}
        </p>
      </header>

      <div className="guest-register-panel">
        {error && (
          <div className="guest-register-error" role="alert">
            {error}
          </div>
        )}

        <form className="guest-register-form" onSubmit={handleRegister} aria-busy={isSubmitting}>
          <section className="guest-register-group">
            <header className="guest-register-group-heading">
              <p>01 / PERSONAL DETAILS</p>
              <h2>Your details</h2>
            </header>
            <div className="guest-register-fields">{personalFields.map(renderField)}</div>
          </section>

          <section className="guest-register-group">
            <header className="guest-register-group-heading">
              <p>02 / ACCOUNT ACCESS</p>
              <h2>Login credentials</h2>
            </header>
            <div className="guest-register-fields">{accountFields.map(renderField)}</div>
          </section>

          <button type="submit" className="guest-register-submit" disabled={isSubmitting}>
            {isSubmitting ? "Creating account…" : "Create Account"}
          </button>
        </form>

        <div className="guest-register-signin">
          <p>Already have an account? <Link to="/guest/login" state={returnState}>Sign In</Link></p>
        </div>
      </div>
    </section>
  );
}
