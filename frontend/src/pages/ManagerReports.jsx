import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { isCurrentStaff, loadStaffBranches } from "../services/staffBookingApi";
import { canViewReports, formatReportMoney, loadManagerReport } from "../services/reportApi";
import "./ManagerReports.css";

const reportOptions = [
  { value: "occupancy", label: "Current room occupancy", description: "A snapshot of saved room statuses now. Occupancy is occupied rooms divided by all rooms, including rooms under maintenance. This does not show availability for future stay dates." },
  { value: "billing-summary", label: "Billing summary", description: "Saved bills with recorded payments and outstanding balances. The opened date is when each bill was generated; it is not the payment date." },
  { value: "service-usage", label: "Service usage and charges", description: "Recorded service entries, quantities and charges at the prices saved when each service was used. These charges are not necessarily paid amounts." },
  { value: "revenue", label: "Finalized bill totals", description: "Room and service charges from checked-out bookings, grouped by the month each bill was opened. These are billed amounts, not cash received by payment date or totals grouped by checkout date." },
  { value: "top-services", label: "Most used services", description: "Services ranked by the number of saved usage entries. Quantity is shown separately: one entry can contain more than one unit. This includes historical service usage." },
];
const initialFilters = { type: "occupancy", branchId: "", outstandingOnly: false, year: "", month: "", limit: "5" };
const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const whole = (value) => Number(value).toLocaleString("en-LK");

function ReportTable({ type, rows, title }) {
  let headings;
  let body;
  if (type === "occupancy") {
    headings = ["Branch", "Total rooms", "Occupied", "Available", "Maintenance", "Occupancy rate"];
    body = rows.map((row) => <tr key={row.BranchID}>
      <th scope="row">{row.BranchName}</th><td>{whole(row.TotalRooms)}</td><td>{whole(row.Occupied)}</td><td>{whole(row.Available)}</td><td>{whole(row.Maintenance)}</td>
      <td>{Number(row.TotalRooms) ? `${(Number(row.Occupied) / Number(row.TotalRooms) * 100).toLocaleString("en-LK", { maximumFractionDigits: 1 })}%` : "Not applicable — no rooms"}</td>
    </tr>);
  } else if (type === "billing-summary") {
    headings = ["Booking / bill", "Guest", "Branch", "Bill opened", "Room charges", "Service charges", "Total", "Paid", "Outstanding", "Booking status", "Bill status"];
    body = rows.map((row) => <tr key={row.BillID}>
      <th scope="row"><Link to={`/staff/bookings/${row.BookingID}/bill`}>Booking #{row.BookingID}</Link><span className="report-cell-detail">Bill #{row.BillID}</span></th>
      <td>{row.GuestName}</td><td>{row.BranchName}</td><td className="report-nowrap">{row.GeneratedDateDisplay}</td>
      <td className="report-money">{formatReportMoney(row.RoomCharges)}</td><td className="report-money">{formatReportMoney(row.ServiceCharges)}</td>
      <td className="report-money">{formatReportMoney(row.TotalAmount)}</td><td className="report-money">{formatReportMoney(row.PaidAmount)}</td><td className="report-money">{formatReportMoney(row.OutstandingBalance)}</td>
      <td>{row.BookingStatus}</td><td>{row.BillStatus}</td>
    </tr>);
  } else if (type === "revenue") {
    headings = ["Bill opened month", "Branch", "Finalized bills", "Room revenue", "Service revenue", "Total billed revenue"];
    body = rows.map((row) => <tr key={`${row.BranchScope}:${row.BranchID}:${row.Month}`}>
      <th scope="row">{row.Month}</th><td>{row.BranchName}</td><td>{whole(row.BillCount)}</td>
      <td className="report-money">{formatReportMoney(row.RoomRevenue)}</td><td className="report-money">{formatReportMoney(row.ServiceRevenue)}</td><td className="report-money">{formatReportMoney(row.TotalRevenue)}</td>
    </tr>);
  } else {
    headings = type === "service-usage" ? ["Service", "Usage entries", "Total quantity", "Recorded charges"] : ["Rank", "Service", "Usage entries", "Total quantity"];
    body = rows.map((row, index) => <tr key={row.ServiceID}>
      {type === "top-services" && <td>{index + 1}</td>}
      <th scope="row">{row.ServiceName}</th><td>{whole(row.TimesUsed)}</td><td>{whole(row.TotalQuantity)}</td>
      {type === "service-usage" && <td className="report-money">{formatReportMoney(row.TotalRevenue)}</td>}
    </tr>);
  }
  return <div className="staff-booking-table-wrap" role="region" aria-label={`${title} results`} tabIndex={0}>
    <table className="staff-booking-table">
      <caption>{title} — {rows.length} {rows.length === 1 ? "row" : "rows"} matching the submitted filters</caption>
      <thead><tr>{headings.map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
      <tbody>{body}</tbody>
    </table>
  </div>;
}

export default function ManagerReports({ session }) {
  const token = session?.token;
  const permitted = canViewReports(session?.staff?.role) && isCurrentStaff(token);
  const [filters, setFilters] = useState(initialFilters);
  const [request, setRequest] = useState({ filters: initialFilters, revision: 0 });
  const [result, setResult] = useState({ loading: true, error: "", rows: [], edited: false });
  const [branches, setBranches] = useState({ loading: true, error: "", rows: [] });
  const [branchRevision, setBranchRevision] = useState(0);
  const currentRequest = useRef(null);
  const report = reportOptions.find((option) => option.value === filters.type);

  useEffect(() => {
    if (!permitted) return;
    const controller = new AbortController();
    let active = true;
    const current = () => active && !controller.signal.aborted && isCurrentStaff(token);
    async function load() {
      try {
        const rows = await loadStaffBranches(token, controller.signal);
        if (current()) setBranches({ loading: false, error: "", rows });
      } catch (error) {
        if (current() && error.name !== "AbortError") setBranches({ loading: false, error: "Branch options could not be loaded. You can still view reports for all branches.", rows: [] });
      }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [token, permitted, branchRevision]);

  useEffect(() => {
    if (!permitted) return;
    const controller = new AbortController();
    currentRequest.current = controller;
    let active = true;
    const current = () => active && !controller.signal.aborted && isCurrentStaff(token);
    async function load() {
      try {
        const rows = await loadManagerReport(request.filters.type, request.filters, token, controller.signal);
        if (current()) setResult({ loading: false, error: "", rows, edited: false });
      } catch (error) {
        if (current() && error.name !== "AbortError") setResult({ loading: false, error: error.message, rows: [], edited: false });
      }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [token, permitted, request]);

  function changeFilter(field, value) {
    currentRequest.current?.abort();
    setFilters((previous) => ({ ...previous, [field]: value, ...(field === "year" && !value ? { month: "" } : {}) }));
    setResult({ loading: false, error: "", rows: [], edited: true });
  }

  function loadReport() {
    if (!permitted) return;
    currentRequest.current?.abort();
    setResult({ loading: true, error: "", rows: [], edited: false });
    setRequest((previous) => ({ filters: { ...filters }, revision: previous.revision + 1 }));
  }

  if (!permitted) return <section aria-labelledby="manager-reports-heading"><h1 id="manager-reports-heading">Manager reports</h1><p role="alert">Manager or administrator access is required to view reports.</p><Link className="button" to="/staff">Return to staff account</Link></section>;

  return <section className="manager-reports-page" aria-labelledby="manager-reports-heading">
    <p className="eyebrow">STAFF WORKSPACE</p>
    <h1 id="manager-reports-heading">Manager reports</h1>
    <p>Review live hotel records across branches. Refresh a report to include changes made since it was loaded.</p>
    <nav className="report-navigation" aria-label="Staff workspace"><Link to="/staff">Staff account</Link><Link to="/staff/bookings">Bookings</Link></nav>

    <form className="report-filters" aria-label="Report filters" onSubmit={(event) => { event.preventDefault(); loadReport(); }}>
      <div className="form-field"><label htmlFor="manager-report-type">Report</label>
        <select id="manager-report-type" value={filters.type} onChange={(event) => changeFilter("type", event.target.value)}>{reportOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
      </div>
      <div className="form-field"><label htmlFor="manager-report-branch">Branch</label>
        <select id="manager-report-branch" value={filters.branchId} disabled={branches.loading || Boolean(branches.error)} onChange={(event) => changeFilter("branchId", event.target.value)}>
          <option value="">All branches</option>{branches.rows.map((branch) => <option key={branch.BranchID} value={branch.BranchID}>{branch.Name}</option>)}
        </select>
      </div>
      {filters.type === "billing-summary" && <label className="report-checkbox" htmlFor="manager-report-outstanding"><input id="manager-report-outstanding" type="checkbox" checked={filters.outstandingOnly} onChange={(event) => changeFilter("outstandingOnly", event.target.checked)} />Only bills with outstanding balances</label>}
      {filters.type === "revenue" && <>
        <div className="form-field"><label htmlFor="manager-report-year">Bill opened year (optional)</label><input id="manager-report-year" type="text" inputMode="numeric" pattern="[1-9][0-9]{3}" maxLength={4} placeholder="All years" value={filters.year} onChange={(event) => changeFilter("year", event.target.value)} /></div>
        <div className="form-field"><label htmlFor="manager-report-month">Bill opened month</label><select id="manager-report-month" value={filters.month} disabled={!/^[1-9]\d{3}$/.test(filters.year)} onChange={(event) => changeFilter("month", event.target.value)}><option value="">All months</option>{months.map((month, index) => <option key={month} value={String(index + 1)}>{month}</option>)}</select></div>
      </>}
      {filters.type === "top-services" && <div className="form-field"><label htmlFor="manager-report-limit">Number of services</label><select id="manager-report-limit" value={filters.limit} onChange={(event) => changeFilter("limit", event.target.value)}>{Array.from({ length: 50 }, (_, index) => index + 1).map((limit) => <option key={limit} value={String(limit)}>{limit}</option>)}</select></div>}
      <div className="report-filter-actions"><button className="button" type="submit" disabled={result.loading}>{result.loading ? "Loading report…" : result.edited || result.error ? "Load report" : "Refresh report"}</button></div>
    </form>
    {branches.loading && <p role="status">Loading branch options…</p>}
    {branches.error && <div className="report-branch-error"><p className="form-error" role="alert">{branches.error}</p><button type="button" className="button" onClick={() => { setBranches({ loading: true, error: "", rows: [] }); setBranchRevision((previous) => previous + 1); }}>Retry branches</button></div>}

    <div className="report-description"><h2>{report.label}</h2><p>{report.description}</p>
      {["billing-summary", "revenue"].includes(filters.type) && <p className="report-scope-note">All branches includes every matching record once. Bills spanning more than one branch, or with no assigned room, stay in separate groups. A specific branch includes only bookings assigned entirely to that branch; amounts are not split across branches.</p>}
      {["service-usage", "top-services"].includes(filters.type) && <p className="report-scope-note">All branches includes all recorded usage. Selecting a branch includes only bookings assigned entirely to that branch.</p>}
    </div>
    <div aria-busy={result.loading}>
      {result.loading ? <p role="status">Loading live report…</p>
        : result.edited ? <p role="status">Filters changed. Select Load report to see matching records.</p>
          : result.error ? <><p className="form-error" role="alert">{result.error}</p><button className="button" type="button" onClick={loadReport}>Retry report</button></>
            : !result.rows.length ? <p role="status">No records match these report filters.</p>
              : <ReportTable type={filters.type} rows={result.rows} title={report.label} />}
    </div>
  </section>;
}
