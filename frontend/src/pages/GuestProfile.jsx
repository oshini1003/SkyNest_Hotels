import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { fetchGuestProfile, updateGuestProfile } from "../services/guestApi";
import { changeGuestPassword } from "../services/passwordApi";
import "./GuestProfile.css";

const emptyFields = { name: "", contactNumber: "", email: "", address: "" };
function profileFields(guest) {
  return { name: guest.Name || "", contactNumber: guest.ContactNumber || "",
    email: guest.Email || "", address: guest.Address || "" };
}

export default function GuestProfile({ session, onLogout, onProfileUpdate }) {
  const [guest, setGuest] = useState(null);
  const [formData, setFormData] = useState(emptyFields);
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const active = useRef(false);
  const busy = saving || passwordSaving;

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchGuestProfile()
      .then((data) => {
        if (cancelled) return;
        setGuest(data);
        setFormData(profileFields(data));
      })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [session.token, loadAttempt]);

  function changeField(e) {
    const { name, value } = e.target;
    setFormData((previous) => ({ ...previous, [name]: value }));
  }

  function cancelEdit() {
    setFormData(profileFields(guest));
    setIsEditing(false);
    setError("");
    setMessage("");
  }

  async function handleSaveProfile(e) {
    e.preventDefault();
    if (busy) return;
    setError("");
    setMessage("");
    const fields = {
      name: formData.name.trim(),
      contactNumber: formData.contactNumber.replace(/[\s-]/g, ""),
      email: formData.email.trim(),
      address: formData.address.trim(),
    };
    if (!fields.name || fields.name.length > 100) {
      setError("Enter a name of 1 to 100 characters.");
      return;
    }
    if (!/^\+?[0-9]{7,15}$/.test(fields.contactNumber)) {
      setError("Enter a contact number with 7 to 15 digits, optionally starting with +. Letters are not allowed.");
      return;
    }
    if (fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) {
      setError("Enter a valid email address or leave it empty.");
      return;
    }
    setSaving(true);
    try {
      const result = await updateGuestProfile(fields);
      if (!active.current) return;
      setGuest(result.guest);
      setFormData(profileFields(result.guest));
      setIsEditing(false);
      setMessage("Profile updated successfully!");
      onProfileUpdate?.(result.guest.Name);
    } catch (err) {
      if (active.current) setError(err.message);
    } finally {
      if (active.current) setSaving(false);
    }
  }

  async function handlePasswordChange(e) {
    e.preventDefault();
    if (busy) return;
    setPasswordError("");
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError("All password fields are required.");
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError("New password must be at least 6 characters.");
      return;
    }
    if ([currentPassword, newPassword].some((value) => new TextEncoder().encode(value).length > 72)) {
      setPasswordError("Passwords must use at most 72 UTF-8 bytes. Some characters use more than one byte.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("New password and confirmation do not match.");
      return;
    }
    setPasswordSaving(true);
    try {
      // The existing service clears this guest session after server success;
      // the protected route then returns to sign-in with a password-change notice.
      await changeGuestPassword(currentPassword, newPassword);
    } catch (err) {
      if (active.current) setPasswordError(err.message);
    } finally {
      if (active.current) setPasswordSaving(false);
    }
  }

  return (
    <section className="guest-profile-page">
      <header className="guest-profile-heading">
        <p className="guest-profile-eyebrow">GUEST PORTAL</p>
        <h1>My Account &amp; Profile</h1>
      </header>

      {loading ? <p role="status">Loading your profile…</p> : !guest ? (
        <div>
          <p className="guest-profile-message guest-profile-message--error" role="alert">
            {error || "Unable to load your profile."}
          </p>
          <button className="guest-profile-button guest-profile-button--primary" type="button"
            onClick={() => setLoadAttempt((value) => value + 1)}>Try again</button>
        </div>
      ) : (
        <>
          {error && <p className="guest-profile-message guest-profile-message--error" role="alert">{error}</p>}
          {message && <p className="guest-profile-message" role="status">{message}</p>}
          <div className="guest-profile-panels">
            <section className="guest-profile-panel">
              <header className="guest-profile-panel-heading">
                <p className="guest-profile-section-label">ACCOUNT</p>
                <h2>Personal Information</h2>
              </header>
              {!isEditing ? (
                <div>
                  <dl className="guest-profile-details">
                    <div><dt>Full name</dt><dd>{guest.Name}</dd></div>
                    <div><dt>Username</dt><dd>{guest.Username}</dd></div>
                    <div><dt>Contact number</dt><dd>{guest.ContactNumber}</dd></div>
                    <div><dt>Email</dt><dd>{guest.Email || "Not provided"}</dd></div>
                    <div><dt>NIC / passport number</dt><dd>{guest.IDNumber}</dd></div>
                    <div><dt>Address</dt><dd>{guest.Address || "Not provided"}</dd></div>
                  </dl>
                  <div className="guest-profile-actions">
                    <button className="guest-profile-button guest-profile-button--primary" type="button" disabled={busy}
                      onClick={() => { setIsEditing(true); setError(""); setMessage(""); }}>Edit Profile</button>
                    <Link className="guest-profile-button guest-profile-button--secondary" to="/guest/bookings">My Bookings</Link>
                  </div>
                </div>
              ) : (
                <form className="guest-profile-form" onSubmit={handleSaveProfile}>
                  <div className="guest-profile-field">
                    <label htmlFor="guest-profile-name">Full name</label>
                    <input id="guest-profile-name" name="name" autoComplete="name" maxLength={100}
                      value={formData.name} onChange={changeField} required disabled={busy} />
                  </div>
                  <div className="guest-profile-field">
                    <label htmlFor="guest-profile-phone">Contact number</label>
                    <input id="guest-profile-phone" name="contactNumber" type="tel" autoComplete="tel" maxLength={30}
                      value={formData.contactNumber} onChange={changeField} required disabled={busy}
                      aria-describedby="guest-profile-phone-help" />
                    <small id="guest-profile-phone-help">7–15 digits; an optional + prefix, spaces and hyphens are accepted.</small>
                  </div>
                  <div className="guest-profile-field">
                    <label htmlFor="guest-profile-email">Email (optional)</label>
                    <input id="guest-profile-email" name="email" type="email" autoComplete="email" maxLength={150}
                      value={formData.email} onChange={changeField} disabled={busy} />
                  </div>
                  <div className="guest-profile-field">
                    <label htmlFor="guest-profile-address">Address (optional)</label>
                    <input id="guest-profile-address" name="address" autoComplete="street-address" maxLength={255}
                      value={formData.address} onChange={changeField} disabled={busy} />
                  </div>
                  <div className="guest-profile-actions">
                    <button className="guest-profile-button guest-profile-button--primary" type="submit" disabled={busy}>
                      {saving ? "Saving…" : "Save Changes"}</button>
                    <button className="guest-profile-button guest-profile-button--secondary" type="button" disabled={busy}
                      onClick={cancelEdit}>Cancel</button>
                  </div>
                </form>
              )}
            </section>

            <section className="guest-profile-panel guest-profile-security">
              <header className="guest-profile-panel-heading">
                <p className="guest-profile-section-label">SECURITY</p>
                <h2>Change Password</h2>
              </header>
              <form className="guest-profile-form" onSubmit={handlePasswordChange}>
                {passwordError && <p className="guest-profile-message guest-profile-message--error" role="alert">{passwordError}</p>}
                <div className="guest-profile-field">
                  <label htmlFor="guest-current-password">Current password</label>
                  <input id="guest-current-password" type="password" autoComplete="current-password"
                    value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required disabled={busy} />
                </div>
                <div className="guest-profile-field">
                  <label htmlFor="guest-new-password">New password</label>
                  <input id="guest-new-password" type="password" autoComplete="new-password" minLength={6}
                    value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required disabled={busy} />
                </div>
                <div className="guest-profile-field">
                  <label htmlFor="guest-confirm-password">Confirm new password</label>
                  <input id="guest-confirm-password" type="password" autoComplete="new-password" minLength={6}
                    value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required disabled={busy} />
                </div>
                <button className="guest-profile-button guest-profile-button--primary" type="submit" disabled={busy}>
                  {passwordSaving ? "Updating…" : "Update Password"}</button>
              </form>
            </section>
          </div>
        </>
      )}
      <div className="guest-profile-actions">
        <button className="guest-profile-button guest-profile-button--secondary" type="button" onClick={onLogout}>Sign out</button>
      </div>
    </section>
  );
}
