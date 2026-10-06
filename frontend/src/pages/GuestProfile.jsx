import { useState } from "react";
import { Link } from "react-router";

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
    <section>
      <p className="eyebrow">GUEST PORTAL</p>
      <h1>My Account & Profile</h1>

      {message && (
        <div style={{ background: "#d4edda", color: "#155724", padding: "10px", borderRadius: "4px", marginBottom: "1.5rem", border: "1px solid #c3e6cb" }}>
          {message}
        </div>
      )}

      {/* Personal Information Section */}
      <div style={{ background: "#fdfbf7", padding: "2rem", borderRadius: "8px", border: "1px solid #e2d9cc", marginTop: "1.5rem" }}>
        <h2>Personal Information</h2>
        
        {!isEditing ? (
          <div>
            <p><strong>Name:</strong> {guest.name}</p>
            <p><strong>Email / Username:</strong> {guest.username}</p>
            <p><strong>Phone:</strong> {guest.phone}</p>
            
            <div style={{ marginTop: "1.5rem", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
              <button className="button" onClick={() => setIsEditing(true)}>
                Edit Profile
              </button>
              <Link className="button" style={{ background: "#6c757d" }} to="/guest/bookings">
                My Bookings Shortcut
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSaveProfile} style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: "400px", marginTop: "1rem" }}>
            <div>
              <label style={{ display: "block", marginBottom: "5px", fontWeight: "bold" }}>Name:</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                style={{ padding: "8px", width: "100%", borderRadius: "4px", border: "1px solid #ccc" }}
                required
              />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "5px", fontWeight: "bold" }}>Phone:</label>
              <input
                type="text"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                style={{ padding: "8px", width: "100%", borderRadius: "4px", border: "1px solid #ccc" }}
                required
              />
            </div>
            <div style={{ display: "flex", gap: "1rem", marginTop: "10px" }}>
              <button className="button" type="submit">Save</button>
              <button 
                type="button" 
                className="button" 
                style={{ background: "#6c757d" }} 
                onClick={() => { setIsEditing(false); setFormData(guest); }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Password Change Section */}
      <div style={{ background: "#fdfbf7", padding: "2rem", borderRadius: "8px", border: "1px solid #e2d9cc", marginTop: "2rem" }}>
        <h2>Security / Change Password</h2>
        <form onSubmit={handlePasswordChange} style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: "400px", marginTop: "1rem" }}>
          <div>
            <label style={{ display: "block", marginBottom: "5px", fontWeight: "bold" }}>Current Password:</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              style={{ padding: "8px", width: "100%", borderRadius: "4px", border: "1px solid #ccc" }}
              required
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "5px", fontWeight: "bold" }}>New Password:</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              style={{ padding: "8px", width: "100%", borderRadius: "4px", border: "1px solid #ccc" }}
              required
            />
          </div>
          <button className="button" type="submit" style={{ marginTop: "10px" }}>
            Update Password
          </button>
        </form>
      </div>
    </section>
  );
}