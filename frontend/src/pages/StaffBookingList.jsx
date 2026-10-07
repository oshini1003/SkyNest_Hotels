import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { bookingStatuses, canCheckIn, formatStayDate, isCurrentStaff, isBranchRestricted, loadStaffBookingSearch } from "../services/staffBookingApi";

const emptyFilters = { bookingId: "", guestName: "", idNumber: "", branchId: "", status: "" };

export default function StaffBookingList({ session }) {
  const token = session.token;
  const [filters, setFilters] = useState(emptyFilters);
  const [request, setRequest] = useState({ filters: emptyFilters, revision: 0 });
  const [branches, setBranches] = useState([]);
  const [scope, setScope] = useState(null);
  const [result, setResult] = useState({ loading: true, error: "", bookings: [], edited: false });
  const currentRequest = useRef(null);

  useEffect(() => {
    setScope(null);
    setBranches([]);
    const controller = new AbortController();
    currentRequest.current = controller;
    let active = true;
    const current = () => active && !controller.signal.aborted && isCurrentStaff(token);
    async function load() {
      try {
        const data = await loadStaffBookingSearch(request.filters, token, controller.signal);
        if (!current()) return;
        setScope(data.scope);
        setBranches(data.branches);
        setResult({ loading: false, error: "", bookings: data.bookings, edited: false });
      } catch (error) {
        if (current() && error.name !== "AbortError") setResult({ loading: false, error: error.message, bookings: [], edited: false });
      }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [token, request]);

  function changeFilter(field, value) {
    currentRequest.current?.abort();
    setFilters((previous) => ({ ...previous, [field]: value }));
    setResult({ loading: false, error: "", bookings: [], edited: true });
  }

  function search(nextFilters = filters) {
    currentRequest.current?.abort();
    setResult({ loading: true, error: "", bookings: [], edited: false });
    setRequest((previous) => ({ filters: { ...nextFilters }, revision: previous.revision + 1 }));
  }

  return (
    <section aria-labelledby="staff-bookings-heading">
      <p className="eyebrow">STAFF WORKSPACE</p>
      <h1 id="staff-bookings-heading">Staff bookings</h1>
      <p>Find reservations by reference, guest name, NIC / passport, branch or status.</p>
      <p><Link to="/staff">Staff account</Link></p>
      {!canCheckIn(session.staff.role) && <p className="booking-notice">Your ServiceStaff account can view reservations. Check-in is handled by reception, managers or administrators.</p>}

      {scope && isBranchRestricted(scope.role) && <p className="booking-notice">Your booking access is limited to {scope.branchName}. Clearing filters keeps this branch selected.</p>}

      <form className="staff-booking-filters" onSubmit={(event) => { event.preventDefault(); search(); }} aria-label="Booking search">
        <div className="form-field">
          <label htmlFor="staff-booking-reference">Booking reference</label>
          <input id="staff-booking-reference" type="text" inputMode="numeric" pattern="[1-9][0-9]*" maxLength={10} placeholder="e.g. 3 (without #)" value={filters.bookingId} onChange={(event) => changeFilter("bookingId", event.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="staff-booking-guest">Guest name</label>
          <input id="staff-booking-guest" type="search" maxLength={255} value={filters.guestName} onChange={(event) => changeFilter("guestName", event.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="staff-booking-id">NIC / passport number</label>
          <input id="staff-booking-id" type="search" maxLength={255} value={filters.idNumber} onChange={(event) => changeFilter("idNumber", event.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="staff-booking-branch">Branch</label>
          {!scope ? <input id="staff-booking-branch" value={result.loading ? "Checking branch access…" : "Branch access unavailable"} readOnly disabled />
            : isBranchRestricted(scope.role)
              ? <input id="staff-booking-branch" value={scope.branchName} readOnly aria-describedby="staff-branch-scope" />
              : <select id="staff-booking-branch" value={filters.branchId} onChange={(event) => changeFilter("branchId", event.target.value)}>
                <option value="">All branches</option>
                {branches.map((branch) => <option key={branch.BranchID} value={branch.BranchID}>{branch.Name}</option>)}
              </select>}
          {scope && isBranchRestricted(scope.role) && <small id="staff-branch-scope">Assigned branch</small>}
        </div>
        <div className="form-field">
          <label htmlFor="staff-booking-status">Status</label>
          <select id="staff-booking-status" value={filters.status} onChange={(event) => changeFilter("status", event.target.value)}>
            <option value="">All statuses</option>
            {bookingStatuses.map((status) => <option key={status}>{status}</option>)}
          </select>
        </div>
        <button className="button" type="submit" disabled={result.loading}>{result.loading ? "Searching…" : "Search bookings"}</button>
        <button className="button" type="button" disabled={!Object.values(filters).some(Boolean)} onClick={() => { setFilters(emptyFilters); search(emptyFilters); }}>Clear filters</button>
      </form>

      <p>Showing up to the latest 200 matching reservations. Use filters to find an older booking.</p>
      {result.loading ? <p role="status">Loading bookings…</p>
        : result.edited ? <p role="status">Filters changed. Select Search bookings to load matching reservations.</p>
          : result.error ? <><p className="form-error" role="alert">{result.error}</p><button className="button" type="button" onClick={() => search()}>Try again</button></>
            : <>
              <p className="booking-count" role="status">{result.bookings.length} {result.bookings.length === 1 ? "booking" : "bookings"} found.</p>
              {!result.bookings.length ? <p>No bookings match these filters.</p> : (
                <div className="staff-booking-table-wrap" role="region" aria-label="Booking results" tabIndex={0}>
                  <table className="staff-booking-table">
                    <caption>Reservations matching your submitted filters</caption>
                    <thead><tr><th scope="col">Reference</th><th scope="col">Guest</th><th scope="col">Rooms and stay dates</th><th scope="col">Status</th><th scope="col">Details</th></tr></thead>
                    <tbody>{result.bookings.map((booking) => (
                      <tr key={booking.BookingID}>
                        <th scope="row">#{booking.BookingID}</th>
                        <td>{booking.GuestName}<br />{booking.IDNumber || "No ID recorded"}</td>
                        <td>{booking.rooms.length ? booking.rooms.map((room) => (
                          <p key={room.RoomID}>
                            {room.BranchName} · Room {room.RoomNumber} · {room.RoomTypeName}
                            <span className="staff-stay-date">In: {formatStayDate(room.CheckInDate)}</span>
                            <span className="staff-stay-date">Out: {formatStayDate(room.CheckOutDate)}</span>
                          </p>
                        )) : "No room assigned"}</td>
                        <td><span className="booking-status" data-status={booking.BookingStatus}>{booking.BookingStatus}</span></td>
                        <td><Link className="staff-service-link" to={`/staff/bookings/${booking.BookingID}`}>View booking<span className="booking-sr-only"> #{booking.BookingID}</span></Link></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </>}
    </section>
  );
}
