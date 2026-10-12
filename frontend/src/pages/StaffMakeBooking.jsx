import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { validateStay } from "../services/roomApi";
import { selectedGuest, selectedStay } from "../services/bookingIntent";
import { createStaffBooking, isCurrentStaff, loadStaffBookingAvailability } from "../services/staffGuestBookingApi";
import { ReviewProgress, ReviewSymbol } from "./MakeBooking";
import "./MakeBooking.css";

const money = new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR", currencyDisplay: "code" });
const guestLabel = (count) => `${count} ${count === 1 ? "guest" : "guests"}`;

export default function StaffMakeBooking({ session }) {
  const { state } = useLocation();
  const selection = useMemo(() => selectedStay(state?.stay), [state?.stay]);
  const guest = useMemo(() => selectedGuest(state?.guest), [state?.guest]);
  if (!selection || !guest) {
    return (
      <section className="booking-review-page" aria-labelledby="staff-selection-heading">
        <div className="review-state-card">
          <ReviewSymbol />
          <p className="review-eyebrow">FRONT DESK</p>
          <h1 id="staff-selection-heading">Choose a guest and rooms first</h1>
          <p>Start a new booking to pick the guest, then the rooms and dates.</p>
          <div className="review-actions">
            <Link className="button review-button" to="/staff/bookings/new">New booking</Link>
            <Link className="review-text-link" to="/staff/bookings">Bookings</Link>
          </div>
        </div>
      </section>
    );
  }
  const roomsKey = selection.rooms.map((room) => `${room.roomId}x${room.guests}`).join(",");
  return (
    <StaffBookingReview
      key={`${session.token}:${guest.guestId}:${roomsKey}:${selection.checkin}:${selection.checkout}`}
      selection={selection}
      guest={guest}
      token={session.token}
      alreadyAttempted={state?.bookingSubmitted === true}
    />
  );
}

function StaffBookingReview({ selection, guest, token, alreadyAttempted }) {
  const navigate = useNavigate();
  const { checkin, checkout } = selection;
  const [requested] = useState(selection.rooms);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState({ loading: true, error: "", rooms: [], unavailable: 0 });
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
    loadStaffBookingAvailability({ checkin, checkout, rooms: requested }, token, controller.signal)
      .then(({ rooms, unavailable, scope }) => {
        if (!active || controller.signal.aborted) return;
        if (!isCurrentStaff(token)) {
          setStatus({ loading: false, error: "Your staff session has changed. Please sign in again.", rooms: [], unavailable: 0 });
          return;
        }
        setStatus({ loading: false, error: "", rooms, unavailable, scope });
      }).catch((error) => {
        if (active && !controller.signal.aborted) {
          setStatus({ loading: false, error: error.name === "AbortError"
            ? "Your staff session has changed. Please sign in again."
            : error.message, rooms: [], unavailable: 0 });
        }
      });
    return () => { active = false; controller.abort(); };
  }, [requested, checkin, checkout, token, attempt]);

  function retryAvailability() {
    setStatus({ loading: true, error: "", rooms: [], unavailable: 0 });
    setAttempt((value) => value + 1);
  }

  async function confirmBooking(event) {
    event.preventDefault();
    if (pending.current || submission.kind !== "idle" || status.loading || status.error || !status.scope ||
        status.rooms.length !== requested.length || !isCurrentStaff(token)) return;
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
    navigate("/staff/make-booking", { replace: true, state: { stay: selection, guest, bookingSubmitted: true } });
    const details = requested.length === 1
      ? { guestId: guest.guestId, roomId: requested[0].roomId, checkin, checkout, guestCount: requested[0].guests, paymentMethod }
      : {
        guestId: guest.guestId,
        checkin,
        checkout,
        paymentMethod,
        rooms: requested.map(({ roomId, guests }) => ({ roomId, guestCount: guests })),
      };
    try {
      const result = await createStaffBooking(details, token, controller.signal);
      if (controller.signal.aborted || !isCurrentStaff(token)) return;
      setSubmission({ kind: "success", message: "", bookingId: result.bookingId });
    } catch (error) {
      if (controller.signal.aborted || !isCurrentStaff(token)) return;
      const kind = error.outcomeUnknown ? "unknown" : error.status === 409 ? "conflict" : "idle";
      setSubmission({ kind, message: error.name === "AbortError"
        ? "The booking check was interrupted. Check the selected rooms again before confirming."
        : error.message, bookingId: null });
      if (!error.outcomeUnknown) {
        navigate("/staff/make-booking", { replace: true, state: { stay: selection, guest } });
        if (error.status === 403 || error.status === 401 || error.name === "AbortError") {
          setStatus({ loading: false, error: error.message, rooms: [], unavailable: 0 });
        }
      }
    } finally {
      pending.current = false;
    }
  }

  const { rooms } = status;
  const totalGuests = rooms.reduce((sum, room) => sum + room.guests, 0);

  if (submission.kind === "success") {
    return (
      <section className="booking-review-page" aria-labelledby="staff-confirmed-heading">
        <ReviewProgress complete />
        <div className="review-state-card review-state-card--confirmed">
          <ReviewSymbol complete />
          <p className="review-eyebrow">RESERVATION SAVED</p>
          <h1 id="staff-confirmed-heading">Booking confirmed</h1>
          <p className="review-reference" role="status">Booking <strong>#{submission.bookingId}</strong> was made for <strong>{guest.name}</strong>.</p>
          <div className="review-confirmed-stay">
            <h2>{rooms.length === 1 ? rooms[0].branch : `${rooms.length} rooms booked`}</h2>
            {rooms.map((room) => (
              <p key={room.id}>{rooms.length > 1 && `${room.branch} · `}Room {room.number} · {room.roomType} · {guestLabel(room.guests)}</p>
            ))}
            <p><time dateTime={checkin}>{checkin}</time> to <time dateTime={checkout}>{checkout}</time> · {guestLabel(totalGuests)}</p>
          </div>
          <p>Payment preference: {paymentMethod}. No payment has been taken.</p>
          <div className="review-actions">
            <Link className="button review-button" to={`/staff/bookings/${submission.bookingId}`}>View booking</Link>
            <Link className="review-text-link" to="/staff/bookings/new">New booking</Link>
          </div>
        </div>
      </section>
    );
  }
  if (submission.kind === "unknown") {
    return (
      <section className="booking-review-page" aria-labelledby="staff-result-heading">
        <div className="review-state-card">
          <ReviewSymbol />
          <p className="review-eyebrow">RESERVATION STATUS</p>
          <h1 id="staff-result-heading">Check the booking result</h1>
          <p className="review-notice" role="alert">
            {submission.message || "A booking request was already started from this page. Check the booking list before making another one; it may already have been saved."}
          </p>
          <div className="review-actions">
            <Link className="button review-button" to="/staff/bookings">Check bookings</Link>
          </div>
        </div>
      </section>
    );
  }
  if (status.loading || status.error || status.unavailable > 0 || rooms.length === 0) {
    const unavailableMessage = requested.length === 1
      ? "This room is no longer available for the selected dates and guest count."
      : `${status.unavailable} of ${requested.length} selected rooms ${status.unavailable === 1 ? "is" : "are"} no longer available. Go back and choose the rooms again.`;
    return (
      <section className="booking-review-page" aria-labelledby="staff-availability-heading">
        <ReviewProgress />
        <div className="review-state-card" aria-busy={status.loading}>
          <ReviewSymbol />
          <p className="review-eyebrow">BOOKING FOR {guest.name.toUpperCase()}</p>
          <h1 id="staff-availability-heading">Review booking</h1>
          {status.loading ? <p role="status">Checking the selected {requested.length === 1 ? "room" : "rooms"} and current prices…</p>
            : status.error ? <p className="review-error" role="alert">{status.error}</p>
              : <p className="review-notice" role="status">{unavailableMessage}</p>}
          <p>No booking has been confirmed. Review the current details before continuing.</p>
          <div className="review-actions">
            {!status.loading && <button className="button review-button" type="button" onClick={retryAvailability}>Check again</button>}
            <Link
              className={`button review-button${status.loading ? "" : " review-button--secondary"}`}
              to="/staff/bookings/rooms"
              state={{ bookingFor: guest, roomSearch: { checkin, checkout, guests: String(requested[0].guests) } }}
            >
              Choose rooms again
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const nights = (Date.parse(`${checkout}T00:00:00Z`) - Date.parse(`${checkin}T00:00:00Z`)) / 86400000;
  const total = rooms.reduce((sum, room) => sum + room.pricePerNight * nights, 0);
  const disabled = submission.kind !== "idle";
  return (
    <section className="booking-review-page" aria-labelledby="staff-make-booking-heading">
      <ReviewProgress />
      <header className="review-page-heading">
        <p className="review-eyebrow">FRONT DESK</p>
        <h1 id="staff-make-booking-heading">Review booking</h1>
        <p>Confirm the stay for the guest below. Availability is checked when you confirm. No payment is taken on this page.</p>
      </header>
      <div className="review-layout">
        <div className="review-information">
          <section className="review-panel" aria-labelledby="staff-guest-heading">
            <div className="review-panel-heading"><span className="review-section-number" aria-hidden="true">01</span><h2 id="staff-guest-heading">Guest</h2></div>
            <dl className="review-guest-details">
              <div><dt>Name</dt><dd>{guest.name}</dd></div>
              <div><dt>Contact number</dt><dd>{guest.contactNumber || "Not provided"}</dd></div>
            </dl>
            {!disabled && <p className="review-account-note"><Link className="review-text-link" to="/staff/bookings/new">Choose a different guest</Link></p>}
          </section>
          <section className="review-panel" aria-labelledby="staff-stay-heading">
            <div className="review-panel-heading"><span className="review-section-number" aria-hidden="true">02</span><h2 id="staff-stay-heading">{rooms.length === 1 ? "Selected stay" : "Selected rooms"}</h2></div>
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
        </div>
        <section className="review-total-panel" aria-labelledby="staff-charge-heading">
          <p className="review-eyebrow">STAY SUMMARY</p>
          <h2 id="staff-charge-heading">Room charges</h2>
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
              <label htmlFor="staff-payment-method">Guest's preferred payment method</label>
              <select id="staff-payment-method" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} disabled={disabled}>
                <option value="Cash">Cash</option><option value="Card">Credit/debit card</option><option value="Bank Transfer">Bank transfer</option>
              </select>
            </div>
            {submission.message && <p className="review-error" role="alert">{submission.message}</p>}
            {submission.kind === "conflict" && (
              <p className="review-conflict-note">The booking was not saved. Choose rooms again to check the latest availability.</p>
            )}
            {submission.kind !== "pending" && (
              <Link
                className="review-text-link"
                to="/staff/bookings/rooms"
                state={{ bookingFor: guest, roomSearch: { checkin, checkout, guests: String(requested[0].guests) } }}
              >Choose rooms again</Link>
            )}
            <button className="button review-button" type="submit" disabled={disabled}>
              {submission.kind === "pending" ? "Confirming booking…" : rooms.length === 1 ? "Confirm booking" : `Confirm ${rooms.length} rooms`}
            </button>
          </form>
        </section>
      </div>
    </section>
  );
}
