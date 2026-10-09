import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { searchRooms, validateStay } from "../services/roomApi";
import { selectedStay } from "../services/bookingIntent";
import { createGuestBooking, isCurrentGuest, loadBookingGuest } from "../services/bookingApi";
import "./MakeBooking.css";

const money = new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR", currencyDisplay: "code" });
const guestLabel = (count) => `${count} ${count === 1 ? "guest" : "guests"}`;

function ReviewProgress({ complete = false }) {
  return (
    <ol className="review-progress" aria-label="Reservation progress">
      <li><span aria-hidden="true">01</span> Choose rooms</li>
      <li aria-current={complete ? undefined : "step"}><span aria-hidden="true">02</span> Review your stay</li>
      <li aria-current={complete ? "step" : undefined}><span aria-hidden="true">03</span> Confirmation</li>
    </ol>
  );
}

function ReviewSymbol({ complete = false }) {
  return (
    <svg className="review-symbol" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      {complete ? <><circle cx="24" cy="24" r="19" /><path d="m15 24 6 6 13-13" /></>
        : <><rect x="8" y="11" width="32" height="29" rx="2" /><path d="M8 20h32M16 7v8M32 7v8M16 28h6M27 28h5M16 33h6" /></>}
    </svg>
  );
}

export default function MakeBooking({ session }) {
  const { state } = useLocation();
  const selection = useMemo(() => selectedStay(state?.stay), [state?.stay]);
  if (!selection) {
    return (
      <section className="booking-review-page" aria-labelledby="booking-selection-heading">
        <div className="review-state-card">
          <ReviewSymbol />
          <p className="review-eyebrow">YOUR NEXT STAY</p>
          <h1 id="booking-selection-heading">Select a room first</h1>
          <p>Choose a room and valid stay dates to review your booking.</p>
          <div className="review-actions">
            <Link className="button review-button" to="/rooms">Find a room</Link>
            <Link className="review-text-link" to="/guest/bookings">My bookings</Link>
          </div>
        </div>
      </section>
    );
  }
  const roomsKey = selection.rooms.map((room) => `${room.roomId}x${room.guests}`).join(",");
  return (
    <BookingReview
      key={`${session.token}:${roomsKey}:${selection.checkin}:${selection.checkout}`}
      selection={selection}
      token={session.token}
      alreadyAttempted={state?.bookingSubmitted === true}
    />
  );
}

function BookingReview({ selection, token, alreadyAttempted }) {
  const navigate = useNavigate();
  const { checkin, checkout } = selection;
  // The component is re-keyed whenever the selection changes, so this never goes stale.
  const [requested] = useState(selection.rooms);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState({ loading: true, error: "", rooms: [], unavailable: 0, profile: null });
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
      Promise.all(requested.map(({ roomId, guests }) =>
        searchRooms({ roomId, checkin, checkout, guests }, controller.signal))),
      loadBookingGuest(token, controller.signal),
    ]).then(([results, profile]) => {
      if (!active || !isCurrentGuest(token)) return;
      const found = requested.map(({ roomId, guests }, index) => {
        const room = results[index].find((item) => item.id === roomId && item.capacity >= guests);
        return room ? { ...room, guests } : null;
      });
      setStatus({
        loading: false,
        error: "",
        rooms: found.filter(Boolean),
        unavailable: found.filter((room) => !room).length,
        profile,
      });
    }).catch((error) => {
      if (active && isCurrentGuest(token) && error.name !== "AbortError") {
        setStatus({ loading: false, error: error.message, rooms: [], unavailable: 0, profile: null });
      }
    });
    return () => { active = false; controller.abort(); };
  }, [requested, checkin, checkout, token, attempt]);

  function retryAvailability() {
    setStatus({ loading: true, error: "", rooms: [], unavailable: 0, profile: null });
    setAttempt((value) => value + 1);
  }

  async function confirmBooking(event) {
    event.preventDefault();
    if (pending.current || submission.kind !== "idle" || status.rooms.length !== requested.length || !isCurrentGuest(token)) return;
    try {
      validateStay({ checkin, checkout, guests: 1 });
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
    // One room keeps the original request shape; several rooms go in one atomic request.
    const details = requested.length === 1
      ? { roomId: requested[0].roomId, checkin, checkout, guestCount: requested[0].guests, paymentMethod }
      : {
        checkin,
        checkout,
        paymentMethod,
        rooms: requested.map(({ roomId, guests }) => ({ roomId, guestCount: guests })),
      };
    try {
      const result = await createGuestBooking(details, token, controller.signal);
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

  const { rooms } = status;
  const totalGuests = rooms.reduce((sum, room) => sum + room.guests, 0);

  if (submission.kind === "success") {
    return (
      <section className="booking-review-page" aria-labelledby="booking-confirmed-heading">
        <ReviewProgress complete />
        <div className="review-state-card review-state-card--confirmed">
          <ReviewSymbol complete />
          <p className="review-eyebrow">RESERVATION SAVED</p>
          <h1 id="booking-confirmed-heading">Booking confirmed</h1>
          <p className="review-reference" role="status">Your booking reference is <strong>#{submission.bookingId}</strong>.</p>
          <div className="review-confirmed-stay">
            <h2>{rooms.length === 1 ? rooms[0].branch : `${rooms.length} rooms booked`}</h2>
            {rooms.map((room) => (
              <p key={room.id}>
                {rooms.length > 1 && `${room.branch} · `}Room {room.number} · {room.roomType} · {guestLabel(room.guests)}
              </p>
            ))}
            <p><time dateTime={checkin}>{checkin}</time> to <time dateTime={checkout}>{checkout}</time> · {guestLabel(totalGuests)}</p>
          </div>
          <p>Your preferred payment method is {paymentMethod}. No payment has been taken.</p>
          <div className="review-actions"><Link className="button review-button" to="/guest/bookings">View My bookings</Link></div>
        </div>
      </section>
    );
  }
  if (submission.kind === "unknown") {
    return (
      <section className="booking-review-page" aria-labelledby="booking-result-heading">
        <div className="review-state-card">
          <ReviewSymbol />
          <p className="review-eyebrow">RESERVATION STATUS</p>
          <h1 id="booking-result-heading">Check your booking result</h1>
          <p className="review-notice" role="alert">
            {submission.message || "A booking request was already started from this page. Check My bookings before making another reservation; it may already have been saved."}
          </p>
          <p>If no booking appears and the result is still unclear, ask hotel staff to check before submitting again.</p>
          <div className="review-actions"><Link className="button review-button" to="/guest/bookings">Check My bookings</Link></div>
        </div>
      </section>
    );
  }
  if (status.loading || status.error || status.unavailable > 0 || rooms.length === 0) {
    const unavailableMessage = requested.length === 1
      ? "This room is no longer available for the selected dates and guest count."
      : `${status.unavailable} of your ${requested.length} selected rooms ${status.unavailable === 1 ? "is" : "are"} no longer available for the selected dates and guest count. Go back and choose your rooms again.`;
    return (
      <section className="booking-review-page" aria-labelledby="booking-availability-heading">
        <ReviewProgress />
        <div className="review-state-card" aria-busy={status.loading}>
          <ReviewSymbol />
          <p className="review-eyebrow">YOUR RESERVATION</p>
          <h1 id="booking-availability-heading">Review your booking</h1>
          {status.loading ? <p role="status">Checking your selected {requested.length === 1 ? "room" : "rooms"}, current prices and guest profile…</p>
            : status.error ? <p className="review-error" role="alert">{status.error}</p>
              : <p className="review-notice" role="status">{unavailableMessage}</p>}
          <p>No booking request has been sent from this review.</p>
          <div className="review-actions">
            {!status.loading && <button className="button review-button" type="button" onClick={retryAvailability}>Check again</button>}
            <Link className={`button review-button${status.loading ? "" : " review-button--secondary"}`} to="/rooms">Find a room</Link>
          </div>
        </div>
      </section>
    );
  }

  const nights = (Date.parse(`${checkout}T00:00:00Z`) - Date.parse(`${checkin}T00:00:00Z`)) / 86400000;
  const total = rooms.reduce((sum, room) => sum + room.pricePerNight * nights, 0);
  const disabled = submission.kind !== "idle";
  return (
    <section className="booking-review-page" aria-labelledby="make-booking-heading">
      <ReviewProgress />
      <header className="review-page-heading">
        <p className="review-eyebrow">YOUR RESERVATION</p>
        <h1 id="make-booking-heading">Review your booking</h1>
        <p>Review your stay and confirm your reservation. Availability is checked when you confirm. No payment is taken on this page.</p>
      </header>
      <div className="review-layout">
        <div className="review-information">
          <section className="review-panel" aria-labelledby="selected-stay-heading">
            <div className="review-panel-heading"><span className="review-section-number" aria-hidden="true">01</span><h2 id="selected-stay-heading">{rooms.length === 1 ? "Your selected stay" : "Your selected rooms"}</h2></div>
            <ul className="review-room-list">
              {rooms.map((room) => (
                <li key={room.id}>
                  <div className="review-room-heading">
                    <ReviewSymbol />
                    <div>
                      <p>{room.branch}</p>
                      <h3>Room {room.number} · {room.roomType}</h3>
                      <span className="review-room-meta">{guestLabel(room.guests)} · {money.format(room.pricePerNight)} per night</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <dl className="review-stay-details">
              <div><dt>Check-in</dt><dd><time dateTime={checkin}>{checkin}</time></dd></div>
              <div><dt>Check-out</dt><dd><time dateTime={checkout}>{checkout}</time></dd></div>
              <div><dt>Guests</dt><dd>{guestLabel(totalGuests)}{rooms.length > 1 ? ` in ${rooms.length} rooms` : ""}</dd></div>
              <div><dt>Length of stay</dt><dd>{nights} {nights === 1 ? "night" : "nights"}</dd></div>
            </dl>
          </section>
          <section className="review-panel" aria-labelledby="booking-guest-heading">
            <div className="review-panel-heading"><span className="review-section-number" aria-hidden="true">02</span><h2 id="booking-guest-heading">Guest account</h2></div>
            <dl className="review-guest-details">
              <div><dt>Name</dt><dd>{status.profile.Name}</dd></div>
              <div><dt>Contact number</dt><dd>{status.profile.ContactNumber}</dd></div>
              <div><dt>Email</dt><dd>{status.profile.Email || "Not provided"}</dd></div>
            </dl>
            <p className="review-account-note">The reservation belongs to your signed-in guest account. <Link className="review-text-link" to="/guest">Edit your profile</Link> if these details need updating.</p>
          </section>
        </div>
        <section className="review-total-panel" aria-labelledby="room-charge-heading">
          <p className="review-eyebrow">STAY SUMMARY</p>
          <h2 id="room-charge-heading">Room charges</h2>
          <dl className="review-price-details">
            <div><dt>Nights</dt><dd>{nights}</dd></div>
            {rooms.map((room) => (
              <div key={room.id}><dt>{room.branch} · Room {room.number} · {room.roomType}</dt><dd>{money.format(room.pricePerNight * nights)}</dd></div>
            ))}
          </dl>
          <div className="review-total"><p>Estimated room charge</p><strong>{money.format(total)}</strong></div>
          <p className="review-charge-note">Services and other charges are excluded.</p>
          <form className="review-confirm-form" onSubmit={confirmBooking} aria-busy={submission.kind === "pending"}>
            <div className="review-payment-field">
              <label htmlFor="payment-method">Preferred payment method</label>
              <select id="payment-method" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} disabled={disabled} aria-describedby="booking-payment-note">
                <option value="Cash">Cash</option><option value="Card">Credit/debit card</option><option value="Bank Transfer">Bank transfer</option>
              </select>
            </div>
            <p className="review-payment-note" id="booking-payment-note">This records your preference only. No payment is taken on this page.</p>
            {submission.message && <p className="review-error" role="alert">{submission.message}</p>}
            {submission.kind === "conflict" && <p className="review-conflict-note">Please search again to see the latest room availability.</p>}
            <button className="button review-button" type="submit" disabled={disabled}>{submission.kind === "pending" ? "Confirming booking…" : rooms.length === 1 ? "Confirm booking" : `Confirm ${rooms.length} rooms`}</button>
          </form>
        </section>
      </div>
      {submission.kind !== "pending" && <nav className="review-bottom-links" aria-label="Other booking options"><Link className="review-text-link" to="/rooms">Choose another stay</Link><Link className="review-text-link" to="/guest/bookings">My bookings</Link></nav>}
    </section>
  );
}
