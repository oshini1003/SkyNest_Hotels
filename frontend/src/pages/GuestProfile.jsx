import { useEffect, useState } from "react";
import { Link } from "react-router";
import { fetchGuestProfile, updateGuestProfile } from "../services/guestApi";
import { changeGuestPassword } from "../services/passwordApi";
import ChangePasswordForm from "./ChangePasswordForm";

function ProfileAvatar({ name }) {
  const initials = (name || "G")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return <div className="profile-avatar">{initials}</div>;
}

function InfoBadge({ label, value }) {
  return (
    <div className="profile-info-badge">
      <span className="profile-info-label">{label}</span>
      <span className="profile-info-value">{value || "—"}</span>
    </div>
  );
}

export default function GuestProfile({ session, onLogout, onProfileUpdate }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  // Form fields
  const [name, setName] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchGuestProfile()
      .then((data) => {
        if (cancelled) return;
        setProfile(data);
        setName(data.Name || "");
        setContactNumber(data.ContactNumber || "");
        setEmail(data.Email || "");
        setAddress(data.Address || "");
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [session.token, loadAttempt]);

  function handleCancel() {
    if (profile) {
      setName(profile.Name || "");
      setContactNumber(profile.ContactNumber || "");
      setEmail(profile.Email || "");
      setAddress(profile.Address || "");
    }
    setEditing(false);
    setError("");
    setSuccess("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (saving) return;
    setError("");
    setSuccess("");

    const cleanedName = name.trim();
    const cleanedContact = contactNumber.replace(/[\s-]/g, "");
    if (!cleanedName || cleanedName.length > 100) {
      setError("Enter a name of 1 to 100 characters.");
      return;
    }
    if (!/^\+?[0-9]{7,15}$/.test(cleanedContact)) {
      setError("Enter a contact number with 7 to 15 digits, optionally starting with +. Letters are not allowed.");
      return;
    }
    setSaving(true);

    try {
      const result = await updateGuestProfile({
        name: cleanedName,
        contactNumber: cleanedContact,
        email: email.trim(),
        address: address.trim(),
      });

      setProfile(result.guest);
      setName(result.guest.Name || "");
      setContactNumber(result.guest.ContactNumber || "");
      setEmail(result.guest.Email || "");
      setAddress(result.guest.Address || "");
      setSuccess("Profile updated successfully!");
      setEditing(false);

      if (onProfileUpdate && result.guest) {
        onProfileUpdate(result.guest.Name);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="profile-page">
        <div className="profile-loading">
          <div className="profile-loading-spinner" />
          <p>Loading your profile…</p>
        </div>
      </section>
    );
  }

  if (!profile) {
    return (
      <section className="profile-page">
        <h1>Your profile</h1>
        <p className="form-error" role="alert">{error || "Unable to load your profile."}</p>
        <button className="button" type="button" onClick={() => setLoadAttempt((value) => value + 1)}>
          Try again
        </button>
      </section>
    );
  }

  return (
    <section className="profile-page">
      {/* ─── Header Banner ─── */}
      <div className="profile-banner">
        <div className="profile-banner-content">
          <ProfileAvatar name={profile?.Name} />
          <div className="profile-banner-info">
            <p className="eyebrow">GUEST ACCOUNT</p>
            <h1 className="profile-banner-name">
              {profile?.Name || "Guest"}
            </h1>
            <p className="profile-banner-meta">
              @{profile?.Username} · ID {profile?.IDNumber}
            </p>
          </div>
          <button
            className="button profile-signout-btn"
            type="button"
            onClick={onLogout}
          >
            Sign out
          </button>
        </div>
      </div>

      <p><Link className="button" to="/guest/bookings">My bookings</Link></p>

      {/* ─── Profile Content ─── */}
      <div className="profile-tab-content">
        {error && <p className="form-error" role="alert">{error}</p>}
        {success && <p className="form-success" role="status">{success}</p>}

        {!editing ? (
          /* ── View Mode ── */
          <div className="profile-view">
            <div className="profile-view-header">
              <h2>Personal Information</h2>
              <button
                className="button profile-edit-btn"
                type="button"
                onClick={() => {
                  setEditing(true);
                  setSuccess("");
                }}
              >
                ✏️ Edit Profile
              </button>
            </div>

            <div className="profile-info-grid">
              <InfoBadge label="Full Name" value={profile?.Name} />
              <InfoBadge label="Contact Number" value={profile?.ContactNumber} />
              <InfoBadge label="Email Address" value={profile?.Email} />
              <InfoBadge label="Address" value={profile?.Address} />
            </div>
          </div>
        ) : (
          /* ── Edit Mode ── */
          <div className="profile-edit-section">
            <h2>Edit Personal Information</h2>
            <form className="profile-edit-form" onSubmit={handleSubmit}>
              <div className="form-field">
                <label htmlFor="pf-name">Full Name</label>
                <input
                  id="pf-name"
                  type="text"
                  maxLength={100}
                  disabled={saving}
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="Enter your full name"
                />
              </div>

              <div className="form-field">
                <label htmlFor="pf-phone">Contact Number</label>
                <input
                  id="pf-phone"
                  type="tel"
                  autoComplete="tel"
                  maxLength={30}
                  disabled={saving}
                  aria-describedby="pf-phone-help"
                  value={contactNumber}
                  onChange={(e) => setContactNumber(e.target.value)}
                  required
                  placeholder="e.g. 0771234567"
                />
                <small id="pf-phone-help">7–15 digits; an optional + prefix, spaces and hyphens are accepted.</small>
              </div>

              <div className="form-field">
                <label htmlFor="pf-email">Email Address</label>
                <input
                  id="pf-email"
                  type="email"
                  autoComplete="email"
                  maxLength={150}
                  disabled={saving}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. guest@example.com"
                />
              </div>

              <div className="form-field">
                <label htmlFor="pf-address">Address</label>
                <input
                  id="pf-address"
                  type="text"
                  autoComplete="street-address"
                  maxLength={255}
                  disabled={saving}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="e.g. Colombo, Sri Lanka"
                />
              </div>

              <div className="profile-edit-actions">
                <button className="button" type="submit" disabled={saving}>
                  {saving ? "Saving…" : "💾 Save Changes"}
                </button>
                <button
                  className="button profile-cancel-btn"
                  type="button"
                  onClick={handleCancel}
                  disabled={saving}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        <ChangePasswordForm onChangePassword={changeGuestPassword} />
      </div>
    </section>
  );
}
