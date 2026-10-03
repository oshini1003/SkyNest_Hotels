import { changeStaffPassword } from "../services/passwordApi";
import ChangePasswordForm from "./ChangePasswordForm";
import { Link } from "react-router";
import { canCheckIn } from "../services/staffBookingApi";

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
        {canCheckIn(staff.role)
          ? "Find reservations, check in guests, record services and received payments, and check out fully paid bookings."
          : "View reservations, bills and payment history, and record services for checked-in bookings. Reception, managers or administrators handle check-in, payments and check-out."}
      </p>
      <p><Link className="button" to="/staff/bookings">{canCheckIn(staff.role) ? "Manage bookings" : "View bookings"}</Link></p>

      <ChangePasswordForm onChangePassword={changeStaffPassword} />

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
