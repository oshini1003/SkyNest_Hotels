import { useState } from "react";
import { Link } from "react-router";
import { registerGuest } from "../services/auth";

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

const fields = [
  {
    name: "name", label: "Full name", type: "text",
    autoComplete: "name", maxLength: 100,
  },
  {
    name: "contactNumber", label: "Contact number", type: "tel",
    autoComplete: "tel", maxLength: 20,
  },
  {
    name: "email", label: "Email (optional)", type: "email",
    autoComplete: "email", maxLength: 150,
  },
  {
    name: "idNumber", label: "NIC / passport number", type: "text",
    autoComplete: "off", maxLength: 30,
  },
  {
    name: "address", label: "Address (optional)", type: "text",
    autoComplete: "street-address", maxLength: 255,
  },
  {
    name: "username", label: "Username", type: "text",
    autoComplete: "username", maxLength: 60,
  },
  {
    name: "password", label: "Password", type: "password",
    autoComplete: "new-password",
  },
  {
    name: "confirmPassword", label: "Confirm password", type: "password",
    autoComplete: "new-password",
  },
];

export default function GuestRegister({ onLogin }) {
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleChange(event) {
    const { name, value } = event.target;

    if (
      name === "contactNumber" &&
      !/^\+?[0-9 -]*$/.test(value)
    ) {
      setError(
        "Contact number can contain digits, spaces, hyphens, and an optional + at the start."
      );
      return;
    }

    setError("");
    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (isSubmitting) return;

    setError("");

    const details = {
      name: form.name.trim(),
      contactNumber: form.contactNumber.trim(),
      email: form.email.trim(),
      idNumber: form.idNumber.trim(),
      address: form.address.trim(),
      username: form.username.trim(),
      password: form.password,
    };

    if (
      !details.name ||
      !details.contactNumber ||
      !details.idNumber ||
      !details.username ||
      !details.password
    ) {
      setError("Please complete all required fields.");
      return;
    }

    const contactNumber = details.contactNumber.replace(/[ -]/g, "");

    if (!/^\+?[0-9]{7,15}$/.test(contactNumber)) {
    setError(
        "Enter a contact number with 7–15 digits, for example 0712345678 or +94712345678."
    );
    return;
    }

    details.contactNumber = contactNumber;    

    if (form.password !== form.confirmPassword) {
      setError("Your passwords do not match.");
      return;
    }

    setIsSubmitting(true);

    try {
      const session = await registerGuest(details);
      onLogin(session);
    } catch (err) {
      setError(err.message || "Unable to create your account.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section
      className="auth-card registration-card"
      aria-labelledby="register-heading"
    >
      <p className="eyebrow">GUEST REGISTRATION</p>
      <h1 id="register-heading">Create your account</h1>
      <p>Enter your details to get started with SkyNest Hotels.</p>

      <form
        className="auth-form registration-form"
        onSubmit={handleSubmit}
        aria-busy={isSubmitting}
      >
        {fields.map((field) => (
          <div className="form-field" key={field.name}>
            <label htmlFor={`register-${field.name}`}>
              {field.label}
            </label>

            <input
              id={`register-${field.name}`}
              name={field.name}
              type={field.type}
              autoComplete={field.autoComplete}
              maxLength={field.maxLength}
              value={form[field.name]}
              onChange={handleChange}
              disabled={isSubmitting}
              required={!["email", "address"].includes(field.name)}
            />
          </div>
        ))}

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
          {isSubmitting ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="auth-switch">
        Already have an account?{" "}
        <Link to="/guest/login">Sign in</Link>
      </p>
    </section>
  );
}