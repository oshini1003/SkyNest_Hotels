export default function StaffHome({ staff, onLogout }) {
  return (
    <section
      className="auth-card"
      aria-labelledby="staff-account-heading"
    >
      <p className="eyebrow">STAFF ACCOUNT</p>

      <h1 id="staff-account-heading">
        Welcome, {staff.name}
      </h1>

      <dl className="staff-account-details">
        <div>
          <dt>Username</dt>
          <dd>{staff.username}</dd>
        </div>

        <div>
          <dt>Role</dt>
          <dd>{staff.role}</dd>
        </div>
      </dl>

      <p>
        Booking, service and payment tools will be added here.
      </p>

      <button
        className="button"
        type="button"
        onClick={onLogout}
      >
        Sign out
      </button>
    </section>
  );
}