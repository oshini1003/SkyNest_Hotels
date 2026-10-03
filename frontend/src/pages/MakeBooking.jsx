import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { searchRooms, validateStay } from "../services/roomApi";
import { selectedStay } from "../services/bookingIntent";
import { createGuestBooking, isCurrentGuest, loadBookingGuest } from "../services/bookingApi";

const money = new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR", currencyDisplay: "code" });

export default function MakeBooking({ session }) {
  const { state } = useLocation();
  const selection = selectedStay(state?.stay);
  if (!selection) {
    return (
      <section>
        <h1>Select a room first</h1>
        <p>Choose a room and valid stay dates to review your booking.</p>
        <Link className="button" to="/rooms">Find a room</Link>
        <p><Link to="/guest/bookings">My bookings</Link></p>
      </section>
    );
  }
  return (
    <BookingReview
      key={`${session.token}:${selection.roomId}:${selection.checkin}:${selection.checkout}:${selection.guests}`}
      selection={selection}
      token={session.token}
      alreadyAttempted={state?.bookingSubmitted === true}
    />
  );
}

function BookingReview({ selection, token, alreadyAttempted }) {
  const navigate = useNavigate();
  const { roomId, checkin, checkout, guests } = selection;
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState({ loading: true, error: "", room: null, profile: null });
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [submission, setSubmission] = useState({ kind: alreadyAttempted ? "unknown" : "idle", message: "", bookingId: null });
  const attemptedOnMount = useRef(alreadyAttempted);
  const pending = useRef(false);
  const mutation = useRef(null);

  useEffect(() => () => mutation.current?.abort(), []);
  useEffect(() => {
    if (attemptedOnMount.current) return;
    let active = true;
    const controller = new AbortController();
    Promise.all([
      searchRooms({ roomId, checkin, checkout, guests }, controller.signal),
      loadBookingGuest(token, controller.signal),
    ]).then(([rooms, profile]) => {
      if (!active || !isCurrentGuest(token)) return;
      const room = rooms.find((item) => item.id === roomId && item.capacity >= guests) || null;
      setStatus({ loading: false, error: "", room, profile });
    }).catch((error) => {
      if (active && isCurrentGuest(token) && error.name !== "AbortError") {
        setStatus({ loading: false, error: error.message, room: null, profile: null });
      }
    });
    return () => { active = false; controller.abort(); };
  }, [roomId, checkin, checkout, guests, token, attempt]);

  function retryAvailability() {
    setStatus({ loading: true, error: "", room: null, profile: null });
    setAttempt((value) => value + 1);
  }

  async function confirmBooking(event) {
    event.preventDefault();
    if (pending.current || submission.kind !== "idle" || !status.room || !isCurrentGuest(token)) return;
    try {
      validateStay(selection);
    } catch (error) {
      setSubmission({ kind: "idle", message: error.message, bookingId: null });
      return;
    }
    pending.current = true;
    const controller = new AbortController();
    mutation.current = controller;
    setSubmission({ kind: "pending", message: "", bookingId: null });
    // A reload/back navigation after sending must not accidentally submit twice.
    navigate("/make-booking", { replace: true, state: { stay: selection, bookingSubmitted: true } });
    try {
      const result = await createGuestBooking({ roomId, checkin, checkout, guestCount: guests, paymentMethod }, token, controller.signal);
      if (controller.signal.aborted || !isCurrentGuest(token)) return;
      setSubmission({ kind: "success", message: "", bookingId: result.bookingId });
    } catch (error) {
      if (controller.signal.aborted || !isCurrentGuest(token) || error.name === "AbortError") return;
      const kind = error.outcomeUnknown ? "unknown" : error.status === 409 ? "conflict" : "idle";
      setSubmission({ kind, message: error.message, bookingId: null });
      if (!error.outcomeUnknown) navigate("/make-booking", { replace: true, state: { stay: selection } });
    } finally {
      pending.current = false;
    }
  }

  if (submission.kind === "success") {
    return (
      <section aria-labelledby="booking-confirmed-heading">
        <p className="eyebrow">RESERVATION SAVED</p>
        <h1 id="booking-confirmed-heading">Booking confirmed</h1>
        <p className="room-search-summary" role="status">Your booking reference is <strong>#{submission.bookingId}</strong>.</p>
        <p>{status.room.branch} · Room {status.room.number} · {checkin} to {checkout} · {guests} {guests === 1 ? "guest" : "guests"}</p>
        <p>Your preferred payment method is {paymentMethod}. No payment has been taken.</p>
        <Link className="button" to="/guest/bookings">View My bookings</Link>
      </section>
    );
  }
  if (submission.kind === "unknown") {
    return (
      <section aria-labelledby="booking-result-heading">
        <h1 id="booking-result-heading">Check your booking result</h1>
        <p className="booking-notice" role="alert">
          {submission.message || "A booking request was already started from this page. Check My bookings before making another reservation; it may already have been saved."}
        </p>
        <p>If no booking appears and the result is still unclear, ask hotel staff to check before submitting again.</p>
        <Link className="button" to="/guest/bookings">Check My bookings</Link>
      </section>
    );
  }
  if (status.loading || status.error || !status.room) {
    return (
      <section aria-labelledby="booking-availability-heading">
        <h1 id="booking-availability-heading">Review your booking</h1>
        {status.loading ? <p role="status">Checking your selected room, current price and guest profile…</p>
          : status.error ? <p className="form-error" role="alert">{status.error}</p>
            : <p role="status">This room is no longer available for the selected dates and guest count.</p>}
        <p>No booking request has been sent from this review.</p>
        {!status.loading && <p><button className="button" type="button" onClick={retryAvailability}>Check again</button></p>}
        <Link className="button" to="/rooms">Find a room</Link>
      </section>
    );
  }

  const nights = (Date.parse(`${checkout}T00:00:00Z`) - Date.parse(`${checkin}T00:00:00Z`)) / 86400000;
  const disabled = submission.kind !== "idle";
  return (
    <section aria-labelledby="make-booking-heading">
      <p className="eyebrow">YOUR RESERVATION</p>
      <h1 id="make-booking-heading">Review your booking</h1>
      <p className="room-demo-note">Review your stay and confirm your reservation. Availability is checked when you confirm. No payment is taken on this page.</p>
      <h2>Your selected stay</h2>
      <dl className="stay-details">
        <div><dt>Branch</dt><dd>{status.room.branch}</dd></div>
        <div><dt>Room</dt><dd>{status.room.number} · {status.room.roomType}</dd></div>
        <div><dt>Check-in</dt><dd>{checkin}</dd></div>
        <div><dt>Check-out</dt><dd>{checkout}</dd></div>
        <div><dt>Guests</dt><dd>{guests}</dd></div>
        <div><dt>Nights</dt><dd>{nights}</dd></div>
        <div><dt>Price per night</dt><dd>{money.format(status.room.pricePerNight)}</dd></div>
      </dl>
      <p className="room-price">Estimated room charge: {money.format(status.room.pricePerNight * nights)}</p>
      <p className="room-charge-note">Services and other charges are excluded.</p>
      <h2>Guest account</h2>
      <dl className="stay-details">
        <div><dt>Name</dt><dd>{status.profile.Name}</dd></div>
        <div><dt>Contact number</dt><dd>{status.profile.ContactNumber}</dd></div>
        <div><dt>Email</dt><dd>{status.profile.Email || "Not provided"}</dd></div>
      </dl>
      <p>The reservation belongs to your signed-in guest account. <Link to="/guest">Edit your profile</Link> if these details need updating.</p>
      <form className="room-search-form" onSubmit={confirmBooking} aria-busy={submission.kind === "pending"}>
        <div className="form-field">
          <label htmlFor="payment-method">Preferred payment method</label>
          <select id="payment-method" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} disabled={disabled}>
            <option value="Cash">Cash</option><option value="Card">Credit/debit card</option><option value="Bank Transfer">Bank transfer</option>
          </select>
        </div>
        {submission.message && <p className="form-error" role="alert">{submission.message}</p>}
        {submission.kind === "conflict" && <p>Please search again to see the latest room availability.</p>}
        <button className="button" type="submit" disabled={disabled}>{submission.kind === "pending" ? "Confirming booking…" : "Confirm booking"}</button>
      </form>
      {submission.kind !== "pending" && <p><Link to="/rooms">Choose another stay</Link> · <Link to="/guest/bookings">My bookings</Link></p>}
    </section>
  );
}
