import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { isCurrentStaff } from "../services/staffBookingApi";
import {
  canViewDashboard,
  formatDashboardDate,
  formatDashboardMoney,
  loadManagerDashboard,
} from "../services/dashboardApi";
import "./ManagerDashboard.css";

const whole = (value) => value.toLocaleString("en-LK");
const percent = (value) => value === null ? "Not applicable" : `${value.toLocaleString("en-LK", { maximumFractionDigits: 2 })}%`;

function DashboardIcon({ kind }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {kind === "refresh" ? <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1" /></>
      : kind === "arrival" ? <><path d="M4 12h11m-4-4 4 4-4 4M17 4h3v16h-3" /></>
        : kind === "departure" ? <><path d="M10 12h10m-4-4 4 4-4 4M7 4H4v16h3" /></>
          : <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4m8-4v4M4 10h16m-12 5h3m3 0h2" /></>}
  </svg>;
}

function LoadingOverview() {
  return <div className="md-loading" role="status">
    <p>Loading hotel overview…</p>
    <div className="md-skeleton-grid" aria-hidden="true">{[0, 1, 2, 3].map((item) => <div key={item}><span /><span /><span /></div>)}</div>
  </div>;
}

function StayMetric({ kind, title, count, completed, description }) {
  return <article className="md-metric">
    <div className="md-metric-top"><h2>{title}</h2><DashboardIcon kind={kind} /></div>
    <p className="md-metric-number">{whole(count)}</p>
    {completed !== undefined && <p className="md-metric-status"><span>{whole(completed)} of {whole(count)}</span> completed</p>}
    <p className="md-metric-description">{description}</p>
  </article>;
}

function RoomOverview({ summary }) {
  const statuses = [
    { label: "Occupied", value: summary.occupiedRooms, key: "occupied" },
    { label: "Available", value: summary.availableRooms, key: "available" },
    { label: "Maintenance", value: summary.maintenanceRooms, key: "maintenance" },
  ];
  return <section className="md-rooms" aria-labelledby="md-rooms-heading">
    <div className="md-panel-heading"><div><p className="md-kicker">CURRENT OCCUPANCY</p><h2 id="md-rooms-heading">Rooms right now</h2></div><span className="md-total-rooms">{whole(summary.totalRooms)} rooms</span></div>
    <p className={`md-occupancy-value${summary.totalRooms === 0 ? " md-occupancy-value--empty" : ""}`}>{percent(summary.currentOccupancyPercentage)}<span>{summary.totalRooms ? "of all rooms occupied" : "No rooms in this selection"}</span></p>
    <div className="md-room-bar" aria-hidden="true">{summary.totalRooms > 0 && statuses.map((status) => <span key={status.key} className={`md-room-bar--${status.key}`} style={{ width: `${status.value / summary.totalRooms * 100}%` }} />)}</div>
    <dl className="md-room-legend">{statuses.map((status) => <div key={status.key}><dt><span className={`md-dot md-dot--${status.key}`} aria-hidden="true" />{status.label}</dt><dd>{whole(status.value)}</dd></div>)}</dl>
    <p className="md-panel-note">Includes rooms under maintenance. For availability on future dates, use room search.</p>
  </section>;
}

function BranchOverview({ rows, allBranches, chooseBranch }) {
  return <section className="md-branches" aria-labelledby="md-branches-heading">
    <div className="md-panel-heading"><div><p className="md-kicker">BY LOCATION</p><h2 id="md-branches-heading">{allBranches ? "Across our branches" : "Branch overview"}</h2></div></div>
    {!rows.length ? <p className="md-empty-branches">No branches are available yet.</p>
      : <div className="md-branch-table-wrap" role="region" aria-label="Branch room overview" tabIndex={0}>
        <table className="md-branch-table">
          <caption className="md-sr-only">Current room counts and occupancy for the selected branches</caption>
          <thead><tr><th scope="col">Branch</th><th scope="col">Occupied</th><th scope="col">Available</th><th scope="col">Maintenance</th><th scope="col">Occupancy</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.branchId}>
            <th scope="row">{allBranches ? <button type="button" onClick={() => chooseBranch(String(row.branchId))} aria-label={`View ${row.branchName} dashboard`}>{row.branchName}<span aria-hidden="true">↗</span></button> : row.branchName}<span className="md-branch-room-count">{whole(row.totalRooms)} rooms</span></th>
            <td>{whole(row.occupiedRooms)}</td><td>{whole(row.availableRooms)}</td><td>{whole(row.maintenanceRooms)}</td>
            <td><span className="md-branch-rate">{percent(row.occupancyPercentage)}</span>{row.totalRooms > 0 && <span className="md-branch-meter" aria-hidden="true"><span style={{ width: `${row.occupancyPercentage}%` }} /></span>}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    <p className="md-panel-note">{allBranches ? "Choose a branch name to see its daily overview." : "Choose All branches above to return to the hotel-wide view."}</p>
  </section>;
}

export default function ManagerDashboard({ session }) {
  const token = session?.token;
  const permitted = canViewDashboard(session?.staff?.role) && isCurrentStaff(token);
  const [selection, setSelection] = useState({ branchId: "", revision: 0 });
  const [branches, setBranches] = useState([]);
  const [result, setResult] = useState({ loading: true, data: null, error: "", status: 0 });
  const pending = useRef(null);
  const branchSelect = useRef(null);
  const heading = useRef(null);
  const branchName = selection.branchId === "" ? "All branches"
    : branches.find((branch) => String(branch.branchId) === selection.branchId)?.branchName || `Branch #${selection.branchId}`;

  useEffect(() => {
    if (!permitted) return;
    const controller = new AbortController();
    pending.current = controller;
    let active = true;
    const current = () => active && !controller.signal.aborted && isCurrentStaff(token);
    async function load() {
      try {
        const data = await loadManagerDashboard(selection.branchId, token, controller.signal);
        if (!current()) return;
        if (selection.branchId === "") setBranches(data.branchBreakdown.map(({ branchId, branchName }) => ({ branchId, branchName })));
        setResult({ loading: false, data, error: "", status: 0 });
      } catch (error) {
        if (current() && error.name !== "AbortError") setResult({ loading: false, data: null, error: error.message, status: error.status || 0 });
      }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [token, permitted, selection]);

  function loadSelection(branchId = selection.branchId) {
    if (!permitted) return;
    pending.current?.abort();
    setResult({ loading: true, data: null, error: "", status: 0 });
    setSelection((previous) => ({ branchId, revision: previous.revision + 1 }));
  }

  function chooseBranch(branchId) {
    branchSelect.current?.focus();
    loadSelection(branchId);
  }

  function retryOverview() {
    heading.current?.focus();
    loadSelection();
  }

  if (!permitted) return <section className="manager-dashboard-page" aria-labelledby="md-heading"><p className="md-kicker">STAFF WORKSPACE</p><h1 id="md-heading">Hotel overview</h1><div className="md-error" role="alert"><h2>Manager or administrator access required</h2><p>This dashboard is available to managers and administrators.</p><Link className="md-action" to="/staff">Return to staff account</Link></div></section>;

  const data = result.data;
  const summary = data?.summary;
  const branchRows = !data ? [] : selection.branchId === "" ? data.branchBreakdown
    : [{ branchId: data.branchId, branchName, ...summary, occupancyPercentage: summary.currentOccupancyPercentage }];

  return <section className="manager-dashboard-page" aria-labelledby="md-heading">
    <header className="md-heading-row">
      <div><p className="md-kicker">SKYNEST / MANAGEMENT</p><h1 id="md-heading" ref={heading} tabIndex={-1}>Hotel overview</h1><p className="md-intro">A clear view of your rooms, reservations and payments.</p></div>
      <div className="md-date"><span>SNAPSHOT DATE</span>{data ? <time dateTime={data.date}>{formatDashboardDate(data.date)}</time> : <span className="md-date-pending">{result.loading ? "Loading overview…" : "Overview unavailable"}</span>}</div>
    </header>

    <div className="md-toolbar">
      <div className="md-branch-filter"><label htmlFor="md-branch">Viewing</label><select id="md-branch" ref={branchSelect} value={selection.branchId} disabled={!branches.length} onChange={(event) => loadSelection(event.target.value)}><option value="">All branches</option>{branches.map((branch) => <option key={branch.branchId} value={branch.branchId}>{branch.branchName}</option>)}</select></div>
      <p className="md-refresh-note">Refresh to see the latest activity.</p>
      <button className="md-refresh" type="button" disabled={result.loading} onClick={() => loadSelection()}><DashboardIcon kind="refresh" />{result.loading ? "Loading…" : "Refresh overview"}</button>
    </div>

    <div aria-busy={result.loading}>
      {result.loading ? <LoadingOverview /> : result.error ? <div className="md-error" role="alert"><p className="md-kicker">{branchName}</p><h2>{result.status === 403 ? "Dashboard access is restricted" : "We couldn’t load this overview"}</h2><p>{result.error}</p>{result.status !== 403 && <button className="md-action" type="button" onClick={retryOverview}>Try again</button>}<Link className="md-text-link" to="/staff">Return to staff account <span aria-hidden="true">↗</span></Link></div>
        : data && <>
          <p className="md-sr-only" role="status">Overview loaded for {branchName}, {formatDashboardDate(data.date)}.</p>
          <div className="md-metrics">
            <article className="md-cash"><p className="md-kicker">PAYMENTS RECEIVED</p><h2>For {formatDashboardDate(data.date)}</h2><p className="md-cash-value">{formatDashboardMoney(summary.todayRevenue)}</p><p className="md-cash-detail">{whole(summary.todayPaymentsCount)} {summary.todayPaymentsCount === 1 ? "payment" : "payments"} recorded</p><p className="md-cash-note">Received payments, not finalized bill totals.</p></article>
            <StayMetric kind="arrival" title="Scheduled arrivals" count={summary.todayCheckIns} completed={summary.todayCompletedCheckIns} description="Arrival-date reservations, including those already checked out." />
            <StayMetric kind="departure" title="Scheduled departures" count={summary.todayCheckOuts} completed={summary.todayCompletedCheckOuts} description="Departure-date reservations and their checkout status." />
            <StayMetric kind="bookings" title="Active reservations" count={summary.activeBookings} description="Booked and checked-in stays, across all stay dates." />
          </div>
          <div className="md-detail-grid"><RoomOverview summary={summary} /><BranchOverview rows={branchRows} allBranches={selection.branchId === ""} chooseBranch={chooseBranch} /></div>
          <div className="md-reading-notes"><p><strong>Reading this overview.</strong> Arrivals and departures use scheduled dates and current booking statuses; they are not counts of actions performed today.</p><p>{selection.branchId === "" ? "Payments from bookings spanning multiple branches, or without an assigned room, are included once in this all-branch total." : "Branch payment totals include only bookings assigned entirely to this branch. Bookings spanning branches appear in the all-branch total."}</p></div>
        </>}
    </div>

    <nav className="md-next-actions" aria-label="Management shortcuts"><Link to="/staff/bookings"><span><strong>Booking workspace</strong><span>Arrivals, guest stays, services and billing</span></span><span aria-hidden="true">↗</span></Link><Link to="/staff/reports"><span><strong>Manager reports</strong><span>Explore occupancy, saved bills and service activity</span></span><span aria-hidden="true">↗</span></Link></nav>
  </section>;
}
