import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { cancelGuestBooking, isCurrentGuest, loadMyBookings } from "../services/bookingApi";
import "./MyBookings.css";

const bookingStatuses = ["Booked", "Checked-In", "Checked-Out", "Cancelled"];
const dateFormatter = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
function formatDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Unavailable";
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? "Unavailable" : dateFormatter.format(date);
}

export default function MyBookings({ session }) {
  const token = session.token;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState({ loading: true, error: "", bookings: [] });
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    loadMyBookings(token, controller.signal).then((bookings) => {
      if (active && isCurrentGuest(token)) setResult({ loading: false, error: "", bookings });
    }).catch((error) => {
      if (active && isCurrentGuest(token) && error.name !== "AbortError") setResult({ loading: false, error: error.message, bookings: [] });
    });
    return () => { active = false; controller.abort(); };
  }, [token, attempt]);

  function reload(message = "") {
    setNotice(message);
    setResult({ loading: true, error: "", bookings: [] });
    setAttempt((value) => value + 1);
  }
  const search = query.trim().toLowerCase();
  const bookings = result.bookings.filter((booking) =>
    (!status || booking.BookingStatus === status) &&
    (`#${booking.BookingID} ${booking.rooms.map((room) => `${room.BranchName} ${room.RoomNumber}`).join(" ")}`.toLowerCase().includes(search))
  );
  return (
    <section className="my-bookings-page" aria-labelledby="my-bookings-heading">
      <header className="mb-page-heading">
        <div>
          <p className="mb-eyebrow">YOUR SKYNEST STAYS</p>
          <h1 id="my-bookings-heading">My bookings</h1>
          <p className="mb-introduction">Your reservations, all in one place. Review your stay, request a service, view your bill and manage upcoming bookings.</p>
        </div>
        <nav className="mb-heading-actions" aria-label="Guest booking actions">
          <Link className="mb-button mb-button-primary" to="/rooms">Find a room <span aria-hidden="true">↗</span></Link>
          <Link className="mb-account-link" to="/guest">My account <span aria-hidden="true">→</span></Link>
        </nav>
      </header>
      {notice && <p className="mb-notice" role="status">{notice}</p>}
      <div className="mb-filter-panel" role="search" aria-label="Filter your bookings">
        <div className="mb-field mb-search-field">
          <label htmlFor="my-booking-search">Search bookings</label>
          <input id="my-booking-search" type="search" placeholder="Reference, branch or room" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <div className="mb-field">
          <label htmlFor="my-booking-status">Booking status</label>
          <select id="my-booking-status" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All statuses</option>
            {bookingStatuses.map((value) => <option key={value}>{value}</option>)}
          </select>
        </div>
        <div className="mb-filter-actions">
          <button className="mb-button mb-button-secondary" type="button" disabled={!query && !status} onClick={() => { setQuery(""); setStatus(""); }}>Clear filters</button>
          <button className="mb-refresh-button" type="button" disabled={result.loading} onClick={() => reload()}>Refresh bookings</button>
        </div>
      </div>
      {result.loading ? (
        <div className="mb-state-panel" role="status">
          <StayIcon />
          <h2>Loading your bookings…</h2>
          <p>Your reservation details will appear here.</p>
        </div>
      ) : result.error ? (
        <div className="mb-state-panel">
          <h2>We could not load your bookings</h2>
          <p className="mb-error" role="alert">{result.error}</p>
          <button className="mb-button mb-button-primary" type="button" onClick={() => reload()}>Try again</button>
        </div>
      ) : (
        <>
          <div className="mb-results-heading">
            <h2>Your reservations</h2>
            <p className="mb-booking-count" role="status">{bookings.length} {bookings.length === 1 ? "booking" : "bookings"} found.</p>
          </div>
          {result.bookings.length === 200 && <p className="mb-limit-note">Showing your latest 200 reservations.</p>}
          {!bookings.length ? (
            <div className="mb-state-panel">
              <StayIcon />
              <h2>{result.bookings.length ? "No matching bookings" : "Your next stay starts here"}</h2>
              <p>{result.bookings.length ? "No bookings match your filters. Clear the filters to see all your bookings." : "You have no bookings yet. Choose a room to make your first reservation."}</p>
              {result.bookings.length ? (
                <button className="mb-button mb-button-secondary" type="button" onClick={() => { setQuery(""); setStatus(""); }}>Show all bookings</button>
              ) : <Link className="mb-button mb-button-primary" to="/rooms">Explore rooms <span aria-hidden="true">↗</span></Link>}
            </div>
          ) : (
            <div className="mb-booking-list">{bookings.map((booking) => <BookingCard key={booking.BookingID} booking={booking} token={token} onRefresh={reload} />)}</div>
          )}
        </>
      )}
    </section>
  );
}

function BookingCard({ booking, token, onRefresh }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const mutation = useRef(null);
  const busy = useRef(false);
  useEffect(() => () => mutation.current?.abort(), []);

  async function cancel() {
    if (busy.current || uncertain || !confirming || !isCurrentGuest(token)) return;
    busy.current = true;
    setPending(true);
    setError("");
    const controller = new AbortController();
    mutation.current = controller;
    try {
      await cancelGuestBooking(booking.BookingID, token, controller.signal);
      if (!controller.signal.aborted && isCurrentGuest(token)) onRefresh(`Booking #${booking.BookingID} was cancelled.`);
    } catch (failure) {
      if (controller.signal.aborted || !isCurrentGuest(token) || failure.name === "AbortError") return;
      setError(failure.outcomeUnknown ? "We could not confirm the cancellation result. Refresh your bookings to check its current status before trying again." : failure.message);
      setUncertain(failure.outcomeUnknown || failure.status === 409 || failure.status === 404);
      setConfirming(false);
    } finally {
      busy.current = false;
      if (!controller.signal.aborted && isCurrentGuest(token)) setPending(false);
    }
  }
  return (
    <article className="mb-booking-card" aria-labelledby={`my-booking-${booking.BookingID}`} aria-busy={pending}>
      <header className="mb-card-heading">
        <div>
          <p className="mb-eyebrow">RESERVATION REFERENCE</p>
          <h2 id={`my-booking-${booking.BookingID}`}>Booking #{booking.BookingID}</h2>
        </div>
        <span className="mb-booking-status" data-status={booking.BookingStatus}>{booking.BookingStatus}</span>
      </header>
      <div className="mb-rooms">
        {booking.rooms.map((room) => (
          <section className="mb-room" key={room.RoomID} aria-label={`${room.BranchName}, room ${room.RoomNumber}`}>
            <div className="mb-room-heading">
              <h3>{room.BranchName}</h3>
              <p>Room {room.RoomNumber} <span aria-hidden="true">·</span> {room.RoomTypeName}</p>
            </div>
            <dl className="mb-stay-facts">
              <div><dt>Check-in</dt><dd>{formatDate(room.CheckInDate)}</dd></div>
              <div><dt>Check-out</dt><dd>{formatDate(room.CheckOutDate)}</dd></div>
              <div><dt>Guests</dt><dd>{room.GuestCount} {room.GuestCount === 1 ? "guest" : "guests"}</dd></div>
            </dl>
          </section>
        ))}
      </div>
      <footer className="mb-card-footer">
        <p className="mb-payment-preference"><span>Preferred payment method</span><strong>{booking.PreferredPaymentMethod}</strong></p>
        <div className="mb-card-actions">
          {booking.BookingStatus === "Checked-In" && (
            <Link className="mb-button mb-button-primary" to={`/guest/bookings/${booking.BookingID}/services`} aria-label={`Request a service for booking ${booking.BookingID}`}>Request a service <span aria-hidden="true">↗</span></Link>
          )}
          <Link className="mb-button mb-button-secondary" to={`/guest/bookings/${booking.BookingID}/bill`} aria-label={`View bill and services for booking ${booking.BookingID}`}>View bill &amp; services <span aria-hidden="true">→</span></Link>
          {booking.BookingStatus === "Booked" && !uncertain && !confirming && (
            <button className="mb-cancel-link" type="button" onClick={() => { setConfirming(true); setError(""); }}>Cancel booking</button>
          )}
        </div>
      </footer>
      {booking.BookingStatus === "Booked" && !uncertain && confirming && (
        <div className="mb-cancel-review">
          <h3>Cancel this reservation?</h3>
          <p id={`cancel-confirm-${booking.BookingID}`}>Cancel booking #{booking.BookingID}? This releases the reserved rooms.</p>
          <div className="mb-cancel-actions">
            <button className="mb-button mb-button-secondary" type="button" disabled={pending} onClick={() => setConfirming(false)}>Keep booking</button>
            <button className="mb-button mb-button-danger" type="button" disabled={pending} aria-describedby={`cancel-confirm-${booking.BookingID}`} onClick={cancel}>{pending ? "Cancelling…" : "Yes, cancel booking"}</button>
          </div>
        </div>
      )}
      {error && <p className="mb-error mb-card-error" role="alert">{error}</p>}
      {uncertain && <div className="mb-status-check"><button className="mb-button mb-button-secondary" type="button" onClick={() => onRefresh()}>Check current status</button></div>}
    </article>
  );
}

function StayIcon() {
  return (
    <svg className="mb-stay-icon" width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden="true">
      <path d="M7 37V12h30v25M4 37h36M15 12V7h14v5M18 37V26h8v11M13 18h3m12 0h3m-18 5h3m12 0h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
