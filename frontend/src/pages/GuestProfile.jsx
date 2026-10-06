import { useState } from "react";
import { Link } from "react-router";
import "./GuestProfile.css";

export default function GuestProfile() {
  const [guest, setGuest] = useState({
    name: "Lakshan Gamage",
    username: "lakshan@gmail.com",
    phone: "+94 77 123 4567"
  });

  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState(guest);
  
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");

  function handleSaveProfile(e) {
    e.preventDefault();
    setGuest(formData);
    setIsEditing(false);
    setMessage("Profile updated successfully!");
  }

  function handlePasswordChange(e) {
    e.preventDefault();
    if (!currentPassword || !newPassword) {
      alert("Please fill in both password fields.");
      return;
    }
    setMessage("Password changed successfully!");
    setCurrentPassword("");
    setNewPassword("");
  }

  return (
    <section className="guest-profile-page">
      <header className="guest-profile-heading">
        <p className="guest-profile-eyebrow">GUEST PORTAL</p>
        <h1>My Account &amp; Profile</h1>
      </header>

      {message && (
        <div className="guest-profile-message" role="status">
          {message}
        </div>
      )}

      <div className="guest-profile-panels">
        <section className="guest-profile-panel">
          <header className="guest-profile-panel-heading">
            <p className="guest-profile-section-label">ACCOUNT</p>
            <h2>Personal Information</h2>
          </header>
        
          {!isEditing ? (
            <div>
              <dl className="guest-profile-details">
                <div><dt>Name</dt><dd>{guest.name}</dd></div>
                <div><dt>Email / Username</dt><dd>{guest.username}</dd></div>
                <div><dt>Phone</dt><dd>{guest.phone}</dd></div>
              </dl>
            
              <div className="guest-profile-actions">
                <button className="guest-profile-button guest-profile-button--primary" onClick={() => setIsEditing(true)}>
                  Edit Profile
                </button>
                <Link className="guest-profile-button guest-profile-button--secondary" to="/guest/bookings">
                  My Bookings
                </Link>
              </div>
            </div>
          ) : (
            <form className="guest-profile-form" onSubmit={handleSaveProfile}>
              <div className="guest-profile-field">
                <label htmlFor="guest-profile-name">Name</label>
                <input
                  id="guest-profile-name"
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>
              <div className="guest-profile-field">
                <label htmlFor="guest-profile-phone">Phone</label>
                <input
                  id="guest-profile-phone"
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  required
                />
              </div>
              <div className="guest-profile-actions">
                <button className="guest-profile-button guest-profile-button--primary" type="submit">Save</button>
                <button
                  type="button"
                  className="guest-profile-button guest-profile-button--secondary"
                  onClick={() => { setIsEditing(false); setFormData(guest); }}
                >
                  Cancel
                </button>
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
            <div className="guest-profile-field">
              <label htmlFor="guest-current-password">Current Password</label>
              <input
                id="guest-current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>
            <div className="guest-profile-field">
              <label htmlFor="guest-new-password">New Password</label>
              <input
                id="guest-new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
            </div>
            <button className="guest-profile-button guest-profile-button--primary" type="submit">
              Update Password
            </button>
          </form>
        </section>
      </div>
    </section>
  );
}