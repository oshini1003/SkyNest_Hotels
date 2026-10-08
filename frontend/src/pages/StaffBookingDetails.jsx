import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { canCheckIn, checkInStaffBooking, formatStayDate, isCurrentStaff, loadStaffBooking, staffBookingId } from "../services/staffBookingApi";
import "./StaffBookingDetails.css";

export default function StaffBookingDetails({ session }) {
  const { id } = useParams();
  const bookingId = staffBookingId(id);
  if (bookingId === null) return (
    <section className="staff-reservation-page" aria-labelledby="invalid-reservation-heading">
      <div className="sr-state-panel">
        <ReservationIcon />
        <p className="sr-eyebrow">RESERVATIONS</p>
        <h1 id="invalid-reservation-heading">Invalid booking reference</h1>
        <p>Choose a reservation from the booking list to view its details.</p>
        <Link className="sr-button sr-button-primary" to="/staff/bookings">Back to bookings</Link>
      </div>
    </section>
  );
  return <BookingDetails key={`${session.token}:${bookingId}`} bookingId={bookingId} session={session} />;
}

function BookingDetails({ bookingId, session }) {
  const token = session.token;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState({ loading: true, error: "", booking: null });
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState("");
  const [needsStatusCheck, setNeedsStatusCheck] = useState(false);
  const [notice, setNotice] = useState("");
  const mutation = useRef(null);
  const busy = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    loadStaffBooking(bookingId, token, controller.signal).then((booking) => {
      if (!active || controller.signal.aborted || !isCurrentStaff(token)) return;
      setResult({ loading: false, error: "", booking });
      setNeedsStatusCheck(false);
    }).catch((error) => {
      if (active && !controller.signal.aborted && isCurrentStaff(token) && error.name !== "AbortError") setResult({ loading: false, error: error.message, booking: null });
    });
    return () => { active = false; controller.abort(); };
  }, [bookingId, token, attempt]);
  useEffect(() => () => mutation.current?.abort(), []);

  function reload(message = "") {
    if (busy.current) return;
    setNotice(message);
    setConfirming(false);
    setActionError("");
    setResult({ loading: true, error: "", booking: null });
    setAttempt((value) => value + 1);
  }

  const booking = result.booking;
  const permitted = canCheckIn(session.staff.role);
  const eligible = permitted && booking?.BookingStatus === "Booked" && booking.checkInEligibility.allowed;

  async function confirmCheckIn() {
    if (busy.current || needsStatusCheck || !confirming || !eligible || !isCurrentStaff(token)) return;
    busy.current = true;
    setPending(true);
    setActionError("");
    const controller = new AbortController();
    mutation.current = controller;
    try {
      await checkInStaffBooking(bookingId, token, controller.signal);
      if (controller.signal.aborted || !isCurrentStaff(token)) return;
      busy.current = false;
      reload(`Booking #${bookingId} was checked in. The bill is open; no payment was taken.`);
    } catch (error) {
      if (controller.signal.aborted || !isCurrentStaff(token) || error.name === "AbortError") return;
      setActionError(error.message);
      // A refreshed server view is required before another mutation, including
      // after a conflict or a response whose outcome was not received.
      setNeedsStatusCheck(true);
      setConfirming(false);
    } finally {
      busy.current = false;
      if (!controller.signal.aborted && isCurrentStaff(token)) setPending(false);
    }
  }

  return (
    <section className="staff-reservation-page" aria-labelledby="staff-booking-heading">
      <nav className="sr-breadcrumbs" aria-label="Booking navigation">
        <Link to="/staff/bookings"><span aria-hidden="true">←</span> Back to bookings</Link>
        <Link to="/staff">Staff account</Link>
      </nav>
      <header className="sr-page-heading">
        <div>
          <p className="sr-eyebrow">STAFF WORKSPACE · RESERVATIONS</p>
          <h1 id="staff-booking-heading">Booking #{bookingId}</h1>
          <p className="sr-introduction">Guest details, reserved rooms and everything you need for arrival.</p>
        </div>
        {booking && <span className="sr-status" data-status={booking.BookingStatus}>{booking.BookingStatus}</span>}
      </header>
      {notice && <p className="sr-notice" role="status">{notice}</p>}
      {result.loading ? (
        <div className="sr-state-panel sr-loading-panel" role="status">
          <ReservationIcon />
          <h2>Preparing the reservation</h2>
          <p>Loading booking details…</p>
        </div>
      ) : result.error ? (
        <div className="sr-state-panel">
          <ReservationIcon />
          <h2>Unable to load this reservation</h2>
          <p className="sr-error-copy" role="alert">{result.error}</p>
          <button className="sr-button sr-button-primary" type="button" onClick={() => reload(notice)}>Try again</button>
        </div>
      ) : booking && (
        <div className="sr-layout">
          <div className="sr-reservation-content">
            <section className="sr-guest-panel" aria-labelledby="reservation-guest-heading">
              <div className="sr-guest-heading">
                <span className="sr-guest-symbol" aria-hidden="true">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.35"><circle cx="12" cy="8" r="3.5" /><path d="M4.5 21v-2a7.5 7.5 0 0 1 15 0v2" /></svg>
                </span>
                <div>
                  <p className="sr-eyebrow">GUEST & RESERVATION</p>
                  <h2 id="reservation-guest-heading">{booking.GuestName}</h2>
                </div>
              </div>
              <dl className="sr-guest-details">
                <div><dt>Contact number</dt><dd>{booking.GuestContact || "Not provided"}</dd></div>
                <div><dt>Email address</dt><dd>{booking.GuestEmail || "Not provided"}</dd></div>
                <div><dt>NIC / passport</dt><dd>{booking.GuestIDNumber || "Not provided"}</dd></div>
                <div><dt>Booked by</dt><dd>{booking.StaffName || "Guest reservation"}</dd></div>
                <div><dt>Preferred payment</dt><dd>{booking.PreferredPaymentMethod || "Not recorded"}</dd></div>
                <div><dt>Reserved rooms</dt><dd>{booking.rooms.length} {booking.rooms.length === 1 ? "room" : "rooms"}</dd></div>
              </dl>
              <p className="sr-panel-note">A payment preference does not confirm a payment. View the bill for saved charges and payments.</p>
            </section>

            <section className="sr-rooms-section" aria-labelledby="reserved-rooms-heading">
              <div className="sr-section-heading">
                <div><p className="sr-eyebrow">THE STAY</p><h2 id="reserved-rooms-heading">Reserved rooms</h2></div>
                <span className="sr-room-count">{booking.rooms.length} {booking.rooms.length === 1 ? "room" : "rooms"}</span>
              </div>
              {!booking.rooms.length ? <p className="sr-empty-note">No rooms are assigned to this booking.</p> : (
                <div className="sr-room-list">{booking.rooms.map((room) => (
                  <article className="sr-room-card" key={room.RoomID}>
                    <div className="sr-room-heading">
                      <div>
                        <p className="sr-branch-name">{room.BranchName}</p>
                        <h3>Room {room.RoomNumber} <span>· {room.RoomTypeName}</span></h3>
                      </div>
                      <span className="sr-room-occupants">{room.GuestCount} {room.GuestCount === 1 ? "guest" : "guests"}</span>
                    </div>
                    <dl className="sr-room-dates">
                      <div><dt>Check-in</dt><dd><time dateTime={room.CheckInDate}>{formatStayDate(room.CheckInDate)}</time></dd></div>
                      <div><dt>Check-out</dt><dd><time dateTime={room.CheckOutDate}>{formatStayDate(room.CheckOutDate)}</time></dd></div>
                    </dl>
                    <p className="sr-room-condition">Current room status <span data-status={room.RoomStatus}>{room.RoomStatus}</span></p>
                  </article>
                ))}</div>
              )}
            </section>
          </div>

          <aside className="sr-action-rail" aria-label="Reservation actions">
            <section className="sr-checkin-card" aria-labelledby="check-in-heading">
              <header className="sr-checkin-heading">
                <p className="sr-eyebrow">ARRIVAL DESK</p>
                <h2 id="check-in-heading">Guest check-in</h2>
                <p>Hotel date <time dateTime={booking.checkInEligibility.today}>{formatStayDate(booking.checkInEligibility.today)}</time></p>
              </header>
              <div className="sr-checkin-body">
                {!permitted ? <p className="sr-action-copy">Ask reception, a manager or an administrator to check in this guest. Your ServiceStaff account can record services after check-in.</p>
                  : booking.BookingStatus === "Checked-In" ? <div className="sr-arrival-state"><span className="sr-state-label">GUEST ARRIVED</span><p>The guest is checked in. Check-in opens a bill; it does not record a payment.</p></div>
                    : !eligible ? <p className="sr-action-copy">{booking.checkInEligibility.reason || "This booking is not eligible for check-in."}</p>
                      : !needsStatusCheck && (confirming ? <div className="sr-confirmation">
                        <p className="sr-confirmation-title" id="check-in-confirmation">Confirm arrival of {booking.GuestName} for booking #{bookingId}?</p>
                        <p className="sr-confirmation-rooms">{booking.rooms.map((room) => `${room.BranchName}, room ${room.RoomNumber}`).join("; ")}</p>
                        <p>This marks the reservation Checked-In, occupies its rooms and opens a bill. No payment is taken.</p>
                        <div className="sr-confirmation-actions">
                          <button className="sr-button sr-button-primary" type="button" disabled={pending} aria-describedby="check-in-confirmation" onClick={confirmCheckIn}>{pending ? "Checking in…" : "Confirm check-in"}</button>
                          <button className="sr-button sr-button-secondary" type="button" disabled={pending} onClick={() => setConfirming(false)}>Not yet</button>
                        </div>
                      </div> : <div>
                        <span className="sr-state-label">READY FOR ARRIVAL</span>
                        <p className="sr-action-copy">Confirm that the guest has arrived before checking in this reservation.</p>
                        <button className="sr-button sr-button-primary" type="button" onClick={() => { setConfirming(true); setActionError(""); }}>Check in guest <span aria-hidden="true">→</span></button>
                        <p className="sr-action-note">Check-in opens a bill. No payment is taken.</p>
                      </div>)}
                {actionError && <p className="sr-action-error" role="alert">{actionError}</p>}
                {needsStatusCheck ? <div className="sr-status-check"><p>Refresh the saved status before trying check-in again.</p><button className="sr-button sr-button-primary" type="button" onClick={() => reload()}>Check current status</button></div>
                  : <button className="sr-refresh-button" type="button" disabled={pending} onClick={() => reload()}>Refresh booking <span aria-hidden="true">↻</span></button>}
              </div>
            </section>
            <nav className="sr-stay-actions" aria-label="Guest services and billing">
              <p className="sr-eyebrow">MANAGE THE STAY</p>
              <Link to={`/staff/bookings/${bookingId}/services`}><span><strong>View services</strong><small>Service entries and guest requests</small></span><span aria-hidden="true">→</span></Link>
              <Link to={`/staff/bookings/${bookingId}/bill`}><span><strong>View bill</strong><small>Charges, payments and checkout</small></span><span aria-hidden="true">→</span></Link>
            </nav>
          </aside>
        </div>
      )}
    </section>
  );
}

function ReservationIcon() {
  return <svg className="sr-reservation-icon" aria-hidden="true" width="40" height="44" viewBox="0 0 40 44" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M10 8H5v32h30V8h-5M14 4h12v8H14zM12 21h16M12 28h16M12 35h10" /></svg>;
}
