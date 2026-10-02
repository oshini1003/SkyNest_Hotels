import { useEffect, useState } from "react";
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

  // Form fields
  const [name, setName] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");

  useEffect(() => {
    fetchGuestProfile()
      .then((data) => {
        setProfile(data);
        setName(data.Name || "");
        setContactNumber(data.ContactNumber || "");
        setEmail(data.Email || "");
        setAddress(data.Address || "");
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

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
    setError("");
    setSuccess("");
    setSaving(true);

    try {
      const result = await updateGuestProfile({
        name,
        contactNumber,
        email,
        address,
      });

      setProfile(result.guest);
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

      {/* ─── Profile Content ─── */}
      <div className="profile-tab-content">
        {error && <p className="form-error">{error}</p>}
        {success && <p className="form-success">{success}</p>}

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
                  type="text"
                  value={contactNumber}
                  onChange={(e) => setContactNumber(e.target.value)}
                  required
                  placeholder="e.g. 0771234567"
                />
              </div>

              <div className="form-field">
                <label htmlFor="pf-email">Email Address</label>
                <input
                  id="pf-email"
                  type="email"
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
