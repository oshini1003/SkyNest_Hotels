import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { bookingStatuses, canCheckIn, formatStayDate, isCurrentStaff, isBranchRestricted, loadStaffBookingSearch } from "../services/staffBookingApi";

import "./StaffBookingList.css";

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
    <section className="staff-bookings-page" aria-labelledby="staff-bookings-heading">
      <nav className="sb-breadcrumb" aria-label="Breadcrumb">
        <Link to="/staff">Staff account</Link><span aria-hidden="true">/</span><span>Reservations</span>
      </nav>
      <header className="sb-heading">
        <div>
          <p className="sb-eyebrow">THE FRONT DESK</p>
          <h1 id="staff-bookings-heading">Every stay, at a glance.</h1>
          <p>Find a reservation, review the details and welcome your guests.</p>
        </div>
        <div className="sb-access">
          <span>Booking access</span>
          <strong>{scope ? (isBranchRestricted(scope.role) ? scope.branchName : "All branches") : (result.loading ? "Checking access…" : "Not verified")}</strong>
        </div>
      </header>
      {!canCheckIn(session.staff.role) && <p className="sb-notice">Your ServiceStaff account can view reservations. Reception, managers and administrators handle check-in.</p>}

      <section className="sb-search-panel" aria-labelledby="sb-search-heading">
        <div className="sb-panel-heading">
          <h2 id="sb-search-heading">Find a reservation</h2>
          <p>Use a booking reference, guest details or a combination of filters.</p>
        </div>
        <form className="sb-filters" onSubmit={(event) => { event.preventDefault(); search(); }} aria-label="Booking search">
          <div className="sb-field">
            <label htmlFor="staff-booking-reference">Booking reference</label>
            <input id="staff-booking-reference" type="text" inputMode="numeric" pattern="[1-9][0-9]*" maxLength={10} placeholder="e.g. 8, without #" value={filters.bookingId} onChange={(event) => changeFilter("bookingId", event.target.value)} />
          </div>
          <div className="sb-field">
            <label htmlFor="staff-booking-guest">Guest name</label>
            <input id="staff-booking-guest" type="search" maxLength={255} placeholder="Search by name" value={filters.guestName} onChange={(event) => changeFilter("guestName", event.target.value)} />
          </div>
          <div className="sb-field">
            <label htmlFor="staff-booking-id">NIC / passport number</label>
            <input id="staff-booking-id" type="search" maxLength={255} placeholder="Enter identification number" value={filters.idNumber} onChange={(event) => changeFilter("idNumber", event.target.value)} />
          </div>
          <div className="sb-field">
            <label htmlFor="staff-booking-branch">Branch</label>
            {!scope ? <input id="staff-booking-branch" value={result.loading ? "Checking branch access…" : "Branch access unavailable"} readOnly disabled />
              : isBranchRestricted(scope.role)
                ? <input id="staff-booking-branch" value={scope.branchName} readOnly aria-describedby="staff-branch-scope" />
                : <select id="staff-booking-branch" value={filters.branchId} onChange={(event) => changeFilter("branchId", event.target.value)}>
                  <option value="">All branches</option>
                  {branches.map((branch) => <option key={branch.BranchID} value={branch.BranchID}>{branch.Name}</option>)}
                </select>}
            {scope && isBranchRestricted(scope.role) && <small id="staff-branch-scope">Assigned branch · also applies when filters are cleared</small>}
          </div>
          <div className="sb-field">
            <label htmlFor="staff-booking-status">Reservation status</label>
            <select id="staff-booking-status" value={filters.status} onChange={(event) => changeFilter("status", event.target.value)}>
              <option value="">All statuses</option>
              {bookingStatuses.map((status) => <option key={status}>{status}</option>)}
            </select>
          </div>
          <div className="sb-filter-actions">
            <button className="sb-button" type="submit" disabled={result.loading}>{result.loading ? "Searching…" : "Search bookings"}<span aria-hidden="true"> →</span></button>
            <button className="sb-clear" type="button" disabled={!Object.values(filters).some(Boolean)} onClick={() => { setFilters(emptyFilters); search(emptyFilters); }}>Clear filters</button>
          </div>
        </form>
      </section>

      <section className="sb-results" aria-labelledby="sb-results-heading">
        <div className="sb-results-heading">
          <h2 id="sb-results-heading">Reservations</h2>
          <p>Latest 200 matches · filter to find older stays</p>
        </div>
        {result.loading ? <div className="sb-state" role="status"><span className="sb-state-mark" aria-hidden="true">…</span><h3>Finding your reservations</h3><p>Loading booking details and checking branch access.</p></div>
          : result.edited ? <div className="sb-state" role="status"><h3>Your filters are ready</h3><p>Select Search bookings to see matching reservations.</p></div>
            : result.error ? <div className="sb-state sb-state--error"><h3>Reservations could not be loaded</h3><p role="alert">{result.error}</p><button className="sb-button" type="button" onClick={() => search()}>Try again</button></div>
              : <>
                <p className="sb-count" role="status">{result.bookings.length} {result.bookings.length === 1 ? "reservation" : "reservations"} found</p>
                {!result.bookings.length ? <div className="sb-state"><h3>No matching reservations</h3><p>Try a different guest name, reference or status.</p></div> : (
                  <ul className="sb-reservations">
                    {result.bookings.map((booking) => (
                      <li key={booking.BookingID}>
                        <article className="sb-reservation" aria-labelledby={`sb-reservation-${booking.BookingID}`}>
                          <div className="sb-reference">
                            <span className="sb-label">Booking</span>
                            <h3 id={`sb-reservation-${booking.BookingID}`}>#{booking.BookingID}</h3>
                            <span className="sb-status" data-status={booking.BookingStatus}>{booking.BookingStatus}</span>
                          </div>
                          <div className="sb-guest">
                            <span className="sb-label">Guest</span>
                            <strong>{booking.GuestName}</strong>
                            <span className="sb-id">{booking.IDNumber || "No ID recorded"}</span>
                          </div>
                          <div className="sb-stays">
                            <span className="sb-label">Rooms &amp; stay dates</span>
                            {booking.rooms.length ? booking.rooms.map((room) => (
                              <div className="sb-stay" key={room.RoomID}>
                                <strong>{room.BranchName} · Room {room.RoomNumber}</strong>
                                <span>{room.RoomTypeName}</span>
                                <div className="sb-dates">
                                  <span><span className="sb-date-label">In</span> <time dateTime={room.CheckInDate}>{formatStayDate(room.CheckInDate)}</time></span>
                                  <span aria-hidden="true">—</span>
                                  <span><span className="sb-date-label">Out</span> <time dateTime={room.CheckOutDate}>{formatStayDate(room.CheckOutDate)}</time></span>
                                </div>
                              </div>
                            )) : <p>No room assigned</p>}
                          </div>
                          <Link className="sb-view" to={`/staff/bookings/${booking.BookingID}`}>View booking<span className="booking-sr-only"> #{booking.BookingID}</span><span aria-hidden="true"> →</span></Link>
                        </article>
                      </li>
                    ))}
                  </ul>
                )}
              </>}
      </section>
    </section>
  );
}
