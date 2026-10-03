import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { cancelGuestBooking, isCurrentGuest, loadMyBookings } from "../services/bookingApi";

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
    <section aria-labelledby="my-bookings-heading">
      <p className="eyebrow">YOUR STAYS</p>
      <h1 id="my-bookings-heading">My bookings</h1>
      <p>Reservations saved for your signed-in guest account.</p>
      <p><Link to="/rooms">Find a room</Link> · <Link to="/guest">My account</Link></p>
      {notice && <p className="room-search-summary" role="status">{notice}</p>}
      <div className="booking-filters">
        <div className="form-field">
          <label htmlFor="my-booking-search">Search bookings</label>
          <input id="my-booking-search" type="search" placeholder="Booking reference, branch or room" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="my-booking-status">Booking status</label>
          <select id="my-booking-status" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All statuses</option>
            {bookingStatuses.map((value) => <option key={value}>{value}</option>)}
          </select>
        </div>
        <button className="button" type="button" disabled={!query && !status} onClick={() => { setQuery(""); setStatus(""); }}>Clear filters</button>
        <button className="button" type="button" disabled={result.loading} onClick={() => reload()}>Refresh bookings</button>
      </div>
      {result.loading ? <p role="status">Loading your bookings…</p>
        : result.error ? <><p className="form-error" role="alert">{result.error}</p><button className="button" type="button" onClick={() => reload()}>Try again</button></>
          : <>
            {result.bookings.length === 200 && <p>Showing your latest 200 reservations.</p>}
            <p className="booking-count" role="status">{bookings.length} {bookings.length === 1 ? "booking" : "bookings"} found.</p>
            {!bookings.length ? <p>{result.bookings.length ? "No bookings match your filters. Clear the filters to see all your bookings." : "You have no bookings yet. Choose a room to make your first reservation."}</p>
              : <div className="card-grid">{bookings.map((booking) => <BookingCard key={booking.BookingID} booking={booking} token={token} onRefresh={reload} />)}</div>}
          </>}
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
    <article className="card booking-card">
      <div className="booking-card-header">
        <h2>Booking #{booking.BookingID}</h2>
        <span className="booking-status" data-status={booking.BookingStatus}>{booking.BookingStatus}</span>
      </div>
      {booking.rooms.map((room) => (
        <div key={room.RoomID}>
          <p className="booking-branch">{room.BranchName} · Room {room.RoomNumber} · {room.RoomTypeName}</p>
          <p className="booking-dates">{formatDate(room.CheckInDate)} – {formatDate(room.CheckOutDate)}</p>
          <p>{room.GuestCount} {room.GuestCount === 1 ? "guest" : "guests"}</p>
        </div>
      ))}
      <p>Preferred payment: {booking.PreferredPaymentMethod}</p>
      {booking.BookingStatus === "Booked" && !uncertain && (
        confirming ? <div>
          <p id={`cancel-confirm-${booking.BookingID}`}>Cancel booking #{booking.BookingID}? This releases the reserved room.</p>
          <p><button className="button" type="button" disabled={pending} aria-describedby={`cancel-confirm-${booking.BookingID}`} onClick={cancel}>{pending ? "Cancelling…" : "Yes, cancel booking"}</button></p>
          <button className="button" type="button" disabled={pending} onClick={() => setConfirming(false)}>Keep booking</button>
        </div> : <button className="button" type="button" onClick={() => { setConfirming(true); setError(""); }}>Cancel booking</button>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      {uncertain && <button className="button" type="button" onClick={() => onRefresh()}>Check current status</button>}
    </article>
  );
}
