import { Link } from "react-router";
import { changeStaffPassword } from "../services/passwordApi";
import { canCheckIn, isBranchRestricted } from "../services/staffBookingApi";
import { canViewReports } from "../services/reportApi";
import ChangePasswordForm from "./ChangePasswordForm";
import "./StaffHome.css";

function WorkspaceIcon({ reports = false, property = false }) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {property ? <><path d="M5 21V5l7-3 7 3v16M3 21h18M10 21v-5h4v5M8 7h1m6 0h1M8 11h1m6 0h1" /></> : reports ? <><path d="M4 3v17h17" /><path d="M8 15v-4m5 4V6m5 9V9" /></> : <><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M8 3v4m8-4v4M4 11h16m-11 4h2m3 0h1m-6 3h2" /></>}
    </svg>
  );
}

export default function StaffHome({ staff, onLogout }) {
  const handlesReception = canCheckIn(staff.role);
  const roleLabel = staff.role === "ServiceStaff" ? "Service staff" : staff.role;

  return (
    <section className="staff-dashboard" aria-labelledby="staff-account-heading">
      <header className="staff-dashboard-heading">
        <p className="eyebrow">YOUR WORKSPACE</p>
        <h1 id="staff-account-heading">Welcome, {staff.name}</h1>
        <p>Everything you need for the next guest, the current stay, and the day ahead.</p>
      </header>

      <div className="staff-dashboard-grid">
        <section className="staff-dashboard-operations" aria-labelledby="staff-operations-heading">
          <p className="staff-dashboard-kicker">HOTEL OPERATIONS</p>
          <h2 id="staff-operations-heading">Where would you like to start?</h2>
          <p className="staff-dashboard-description">
            {handlesReception
              ? "Manage arrivals, record guest services and received payments, and complete departures from the booking workspace."
              : "Find a guest's stay, record services and view their bill. Reception, managers and administrators handle arrivals, payments and departures."}
          </p>

          {isBranchRestricted(staff.role) && <p className="staff-dashboard-description">Your booking workspace is limited to your assigned branch.</p>}

          <div className="staff-dashboard-actions">
            {staff.role === "Admin" && (
              <Link className="staff-workspace-card" to="/staff/accounts">
                <span className="staff-workspace-icon"><WorkspaceIcon property /></span>
                <span className="staff-workspace-copy">
                  <span className="staff-workspace-title">Create a staff account</span>
                  <span className="staff-workspace-description">Set up a team member’s sign-in, role and branch assignment.</span>
                </span>
                <span className="staff-workspace-arrow" aria-hidden="true">↗</span>
              </Link>
            )}
            {canViewReports(staff.role) && (
              <>
                <Link className="staff-workspace-card" to="/staff/branches">
                  <span className="staff-workspace-icon"><WorkspaceIcon property /></span>
                  <span className="staff-workspace-copy">
                    <span className="staff-workspace-title">Hotel branches</span>
                    <span className="staff-workspace-description">View destinations and add a branch with its location and contact details.</span>
                  </span>
                  <span className="staff-workspace-arrow" aria-hidden="true">↗</span>
                </Link>
                <Link className="staff-workspace-card" to="/staff/room-types">
                  <span className="staff-workspace-icon"><WorkspaceIcon property /></span>
                  <span className="staff-workspace-copy">
                    <span className="staff-workspace-title">Room types</span>
                    <span className="staff-workspace-description">Review accommodation categories, rates and amenities, or add a new type.</span>
                  </span>
                  <span className="staff-workspace-arrow" aria-hidden="true">↗</span>
                </Link>
                <Link className="staff-workspace-card" to="/staff/rooms">
                  <span className="staff-workspace-icon"><WorkspaceIcon property /></span>
                  <span className="staff-workspace-copy">
                    <span className="staff-workspace-title">Rooms</span>
                    <span className="staff-workspace-description">Browse listed rooms by branch and type, or add a room to the collection.</span>
                  </span>
                  <span className="staff-workspace-arrow" aria-hidden="true">↗</span>
                </Link>
                <Link className="staff-workspace-card" to="/staff/amenities">
                  <span className="staff-workspace-icon"><WorkspaceIcon property /></span>
                  <span className="staff-workspace-copy">
                    <span className="staff-workspace-title">Amenities</span>
                    <span className="staff-workspace-description">Explore room comforts and add amenities for new room types.</span>
                  </span>
                  <span className="staff-workspace-arrow" aria-hidden="true">↗</span>
                </Link>
              </>
            )}
            {canViewReports(staff.role) && (
              <Link className="staff-workspace-card" to="/staff/services">
                <span className="staff-workspace-icon"><WorkspaceIcon /></span>
                <span className="staff-workspace-copy">
                  <span className="staff-workspace-title">Service catalogue</span>
                  <span className="staff-workspace-description">Manage service details, current prices and availability.</span>
                </span>
                <span className="staff-workspace-arrow" aria-hidden="true">↗</span>
              </Link>
            )}
            {canViewReports(staff.role) && (
              <Link className="staff-workspace-card" to="/staff/dashboard">
                <span className="staff-workspace-icon"><WorkspaceIcon reports /></span>
                <span className="staff-workspace-copy">
                  <span className="staff-workspace-title">Hotel overview</span>
                  <span className="staff-workspace-description">Daily payments, scheduled arrivals and current room occupancy.</span>
                </span>
                <span className="staff-workspace-arrow" aria-hidden="true">↗</span>
              </Link>
            )}
            <Link className="staff-workspace-card" to="/staff/bookings">
              <span className="staff-workspace-icon"><WorkspaceIcon /></span>
              <span className="staff-workspace-copy">
                <span className="staff-workspace-title">{handlesReception ? "Manage bookings" : "View bookings"}</span>
                <span className="staff-workspace-description">Reservations, guest stays, services and billing.</span>
              </span>
              <span className="staff-workspace-arrow" aria-hidden="true">↗</span>
            </Link>
            {canViewReports(staff.role) && (
              <Link className="staff-workspace-card" to="/staff/reports">
                <span className="staff-workspace-icon"><WorkspaceIcon reports /></span>
                <span className="staff-workspace-copy">
                  <span className="staff-workspace-title">Manager reports</span>
                  <span className="staff-workspace-description">Room occupancy, billing and service activity across branches.</span>
                </span>
                <span className="staff-workspace-arrow" aria-hidden="true">↗</span>
              </Link>
            )}
          </div>
        </section>

        <aside className="staff-identity-card" aria-labelledby="staff-identity-heading">
          <span className="staff-identity-role">{roleLabel}</span>
          <h2 id="staff-identity-heading">Your staff account</h2>
          <dl>
            <div><dt>Name</dt><dd>{staff.name}</dd></div>
            <div><dt>Username</dt><dd>{staff.username}</dd></div>
          </dl>
          <button className="staff-sign-out" type="button" onClick={onLogout}>Sign out</button>
        </aside>
      </div>

      <section className="staff-security-card" aria-labelledby="staff-security-heading">
        <div className="staff-security-intro">
          <p className="staff-dashboard-kicker">ACCOUNT SETTINGS</p>
          <h2 id="staff-security-heading">Password &amp; security</h2>
          <p>Update the password you use to sign in to your staff account.</p>
        </div>
        <ChangePasswordForm onChangePassword={changeStaffPassword} />
      </section>
    </section>
  );
}
