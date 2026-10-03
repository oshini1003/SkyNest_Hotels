import { useState } from "react";

export default function ChangePasswordForm({ onChangePassword }) {
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  function reset() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setError("");
    setSuccess("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (loading) return;
    setError("");
    setSuccess("");

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError("All fields are required.");
      return;
    }
    if (newPassword.length < 6) {
      setError("New password must be at least 6 characters.");
      return;
    }
    if (new TextEncoder().encode(newPassword).length > 72) {
      setError("New password must be at most 72 bytes. Some characters use more than one byte.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }

    setLoading(true);
    try {
      await onChangePassword(currentPassword, newPassword);
      setSuccess("Password changed successfully!");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");

    } catch (err) {
      setError(err.message || "Failed to change password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="change-password-section">
      <button
        type="button"
        className="change-password-toggle"
        onClick={() => {
          setOpen((v) => !v);
          if (open) reset();
        }}
        aria-expanded={open}
        disabled={loading}
      >
        🔒 {open ? "Cancel" : "Change Password"}
      </button>

      {open && (
        <form className="change-password-form" onSubmit={handleSubmit}>
          {error && <p className="form-error" role="alert">{error}</p>}
          {success && <p className="form-success" role="status">{success}</p>}

          <div className="form-field">
            <label htmlFor="cp-current">Current Password</label>
            <input
              id="cp-current"
              type="password"
              required
              disabled={loading}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>

          <div className="form-field">
            <label htmlFor="cp-new">New Password</label>
            <input
              id="cp-new"
              type="password"
              required
              disabled={loading}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          <div className="form-field">
            <label htmlFor="cp-confirm">Confirm New Password</label>
            <input
              id="cp-confirm"
              type="password"
              required
              disabled={loading}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          <div className="change-password-actions">
            <button className="button" type="submit" disabled={loading}>
              {loading ? "Updating…" : "Update Password"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
