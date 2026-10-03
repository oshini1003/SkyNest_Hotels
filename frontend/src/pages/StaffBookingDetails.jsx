import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { canCheckIn, checkInStaffBooking, formatStayDate, isCurrentStaff, loadStaffBooking, staffBookingId } from "../services/staffBookingApi";

export default function StaffBookingDetails({ session }) {
  const { id } = useParams();
  const bookingId = staffBookingId(id);
  if (bookingId === null) return <section><h1>Invalid booking reference</h1><p>Choose a reservation from the booking list.</p><Link to="/staff/bookings">Back to bookings</Link></section>;
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
    <section aria-labelledby="staff-booking-heading">
      <p className="eyebrow">STAFF WORKSPACE</p>
      <h1 id="staff-booking-heading">Booking #{bookingId}</h1>
      <p><Link to="/staff/bookings">Back to bookings</Link> · <Link to="/staff">Staff account</Link></p>
      {notice && <p className="form-success" role="status">{notice}</p>}
      {result.loading ? <p role="status">Loading booking details…</p>
        : result.error ? <><p className="form-error" role="alert">{result.error}</p><button className="button" type="button" onClick={() => reload(notice)}>Try again</button></>
          : booking && <>
            <div className="card booking-card">
              <div className="booking-card-header"><h2>Guest and reservation</h2><span className="booking-status" data-status={booking.BookingStatus}>{booking.BookingStatus}</span></div>
              <dl className="stay-details">
                <div><dt>Guest</dt><dd>{booking.GuestName}</dd></div>
                <div><dt>Contact number</dt><dd>{booking.GuestContact || "Not provided"}</dd></div>
                <div><dt>NIC / passport</dt><dd>{booking.GuestIDNumber || "Not provided"}</dd></div>
                <div><dt>Email</dt><dd>{booking.GuestEmail || "Not provided"}</dd></div>
                <div><dt>Booked by staff</dt><dd>{booking.StaffName || "Guest reservation"}</dd></div>
                <div><dt>Preferred payment</dt><dd>{booking.PreferredPaymentMethod || "Not recorded"}</dd></div>
              </dl>
              <p>A payment preference does not confirm a payment.</p>
              <p><Link className="staff-service-link" to={`/staff/bookings/${bookingId}/services`}>View services</Link> · <Link className="staff-service-link" to={`/staff/bookings/${bookingId}/bill`}>View bill</Link></p>
            </div>

            <h2>Reserved rooms</h2>
            {!booking.rooms.length ? <p>No rooms are assigned to this booking.</p> : <div className="card-grid">{booking.rooms.map((room) => (
              <article className="card" key={room.RoomID}>
                <h3>{room.BranchName} · Room {room.RoomNumber}</h3>
                <p>{room.RoomTypeName} · {room.GuestCount} {room.GuestCount === 1 ? "guest" : "guests"}</p>
                <p>Check-in: <time dateTime={room.CheckInDate}>{formatStayDate(room.CheckInDate)}</time></p>
                <p>Check-out: <time dateTime={room.CheckOutDate}>{formatStayDate(room.CheckOutDate)}</time></p>
                <p>Current room status: <strong>{room.RoomStatus}</strong></p>
              </article>
            ))}</div>}

            <section className="stay-review" aria-labelledby="check-in-heading">
              <h2 id="check-in-heading">Guest check-in</h2>
              <p>Hotel date: {formatStayDate(booking.checkInEligibility.today)}</p>
              {!permitted ? <p>Ask reception, a manager or an administrator to check in this guest. Your ServiceStaff account can record services after check-in.</p>
                : booking.BookingStatus === "Checked-In" ? <p>The guest is checked in. Check-in opens a bill; it does not record a payment.</p>
                  : !eligible ? <p>{booking.checkInEligibility.reason || "This booking is not eligible for check-in."}</p>
                    : !needsStatusCheck && (confirming ? <div>
                      <p id="check-in-confirmation">Confirm arrival of {booking.GuestName} for booking #{bookingId}?</p>
                      <p>{booking.rooms.map((room) => `${room.BranchName}, room ${room.RoomNumber}`).join("; ")}</p>
                      <p>This marks the reservation Checked-In, occupies its rooms and opens a bill. No payment is taken.</p>
                      <p><button className="button" type="button" disabled={pending} aria-describedby="check-in-confirmation" onClick={confirmCheckIn}>{pending ? "Checking in…" : "Confirm check-in"}</button></p>
                      <button className="button" type="button" disabled={pending} onClick={() => setConfirming(false)}>Not yet</button>
                    </div> : <button className="button" type="button" onClick={() => { setConfirming(true); setActionError(""); }}>Check in guest</button>)}
              {actionError && <p className="form-error" role="alert">{actionError}</p>}
              {needsStatusCheck ? <button className="button" type="button" onClick={() => reload()}>Check current status</button>
                : <p><button className="button" type="button" disabled={pending} onClick={() => reload()}>Refresh booking</button></p>}
            </section>
          </>}
    </section>
  );
}
