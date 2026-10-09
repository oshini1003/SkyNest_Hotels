import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { acknowledgeGuestBookingChange, cancelGuestBooking, isCurrentGuest, loadMyBookings, readGuestBookingChange, updateGuestBooking } from "../services/bookingApi";
import { getLocalToday, searchRooms, validateStay } from "../services/roomApi";
import "./MyBookings.css";

const bookingStatuses = ["Booked", "Checked-In", "Checked-Out", "Cancelled"];
const dateFormatter = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
function bookingChangeState(bookingId, token) {
  try { return readGuestBookingChange(bookingId, token); }
  catch { return { kind: "unavailable" }; }
}

const money = new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR", currencyDisplay: "code" });
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
  const [busyBooking, setBusyBooking] = useState(null);
  const [needsRead, setNeedsRead] = useState(() => new Set());
  const mutationLease = useRef(null);

  function beginMutation(bookingId) {
    if (mutationLease.current || !isCurrentGuest(token)) return null;
    const lease = {};
    mutationLease.current = lease;
    setBusyBooking(bookingId);
    return () => {
      if (mutationLease.current !== lease) return;
      mutationLease.current = null;
      setBusyBooking(null);
    };
  }

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    loadMyBookings(token, controller.signal).then((bookings) => {
      if (active && isCurrentGuest(token)) {
        setResult({ loading: false, error: "", bookings });
        setNeedsRead(new Set());
      }
    }).catch((error) => {
      if (active && isCurrentGuest(token) && error.name !== "AbortError") setResult({ loading: false, error: error.message, bookings: [] });
    });
    return () => { active = false; controller.abort(); };
  }, [token, attempt]);

  function requireFreshRead(bookingId) {
    setNeedsRead((current) => new Set([...current, bookingId]));
  }

  function reload(message = "") {
    if (mutationLease.current) return;
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
      {busyBooking !== null && <p className="mb-notice" role="status">Saving booking #{busyBooking}. Please wait before making another change.</p>}
      <div className="mb-filter-panel" role="search" aria-label="Filter your bookings">
        <div className="mb-field mb-search-field">
          <label htmlFor="my-booking-search">Search bookings</label>
          <input id="my-booking-search" type="search" placeholder="Reference, branch or room" value={query} disabled={busyBooking !== null} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <div className="mb-field">
          <label htmlFor="my-booking-status">Booking status</label>
          <select id="my-booking-status" value={status} disabled={busyBooking !== null} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All statuses</option>
            {bookingStatuses.map((value) => <option key={value}>{value}</option>)}
          </select>
        </div>
        <div className="mb-filter-actions">
          <button className="mb-button mb-button-secondary" type="button" disabled={busyBooking !== null || (!query && !status)} onClick={() => { setQuery(""); setStatus(""); }}>Clear filters</button>
          <button className="mb-refresh-button" type="button" disabled={result.loading || busyBooking !== null} onClick={() => reload()}>Refresh bookings</button>
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
            <div className="mb-booking-list">{bookings.map((booking) => <BookingCard key={booking.BookingID} booking={booking} token={token} onRefresh={reload} pageBusy={busyBooking !== null} beginMutation={beginMutation} requiresRead={needsRead.has(booking.BookingID)} requireFreshRead={requireFreshRead} />)}</div>
          )}
        </>
      )}
    </section>
  );
}

function BookingCard({ booking, token, onRefresh, pageBusy, beginMutation, requiresRead, requireFreshRead }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [changeState, setChangeState] = useState(() => bookingChangeState(booking.BookingID, token));
  const [editing, setEditing] = useState(null);
  const mutation = useRef(null);
  const busy = useRef(false);
  useEffect(() => () => mutation.current?.abort(), []);
  const detailsRead = !requiresRead;
  const blocked = Boolean(changeState) || requiresRead;
  const canEdit = booking.BookingStatus === "Booked" && !blocked;

  function readChangeAfterFailure(failure) {
    const state = bookingChangeState(booking.BookingID, token);
    setChangeState(state);
    if (failure.outcomeUnknown || failure.status === 409 || failure.status === 404) {
      requireFreshRead(booking.BookingID);
    }
    if (state || failure.outcomeUnknown || failure.status === 409 || failure.status === 404) {
      setError(failure.outcomeUnknown ? "We could not confirm the change. Load the current booking before continuing." : failure.message);
    }
    setConfirming(false);
    if (state || failure.outcomeUnknown || failure.status === 409 || failure.status === 404) setEditing(null);
  }

  function acknowledgeReview() {
    if (pageBusy || !detailsRead || !changeState || changeState.kind === "unavailable") return;
    try {
      acknowledgeGuestBookingChange(booking.BookingID, token);
      setChangeState(null);
      setError("");
    } catch {
      setError("We could not clear the booking review. Refresh your bookings and check the current details again.");
    }
  }

  async function cancel() {
    if (busy.current || blocked || !confirming || !isCurrentGuest(token)) return;
    const release = beginMutation(booking.BookingID);
    if (!release) return;
    busy.current = true;
    setPending(true);
    setError("");
    const controller = new AbortController();
    mutation.current = controller;
    try {
      await cancelGuestBooking(booking.BookingID, token, controller.signal);
      if (!controller.signal.aborted && isCurrentGuest(token)) {
        release();
        onRefresh(`Booking #${booking.BookingID} was cancelled.`);
      }
    } catch (failure) {
      if (controller.signal.aborted || !isCurrentGuest(token) || failure.name === "AbortError") return;
      setError(failure.outcomeUnknown ? "We could not confirm the cancellation result. Check the current details before making another change." : failure.message);
      readChangeAfterFailure(failure);
    } finally {
      release();
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
          <section className="mb-room" key={room.BookedRoomID} aria-label={`${room.BranchName}, room ${room.RoomNumber}`}>
            <div className="mb-room-heading">
              <h3>{room.BranchName}</h3>
              <p>Room {room.RoomNumber} <span aria-hidden="true">·</span> {room.RoomTypeName}</p>
            </div>
            <dl className="mb-stay-facts">
              <div><dt>Check-in</dt><dd>{formatDate(room.CheckInDate)}</dd></div>
              <div><dt>Check-out</dt><dd>{formatDate(room.CheckOutDate)}</dd></div>
              <div><dt>Guests</dt><dd>{room.GuestCount} {room.GuestCount === 1 ? "guest" : "guests"}</dd></div>
            </dl>
            {canEdit && editing !== room.BookedRoomID && (
              <button
                className="mb-edit-link"
                type="button"
                disabled={pageBusy}
                onClick={() => { setEditing(room.BookedRoomID); setConfirming(false); setError(""); }}
              >
                Change dates, guests or room
              </button>
            )}
            {canEdit && editing === room.BookedRoomID && (
              <RoomEditor
                booking={booking}
                room={room}
                token={token}
                pageBusy={pageBusy}
                beginMutation={beginMutation}
                onFailure={readChangeAfterFailure}
                onClose={() => setEditing(null)}
                onSaved={onRefresh}
              />
            )}
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
          {canEdit && !confirming && (
            <button className="mb-cancel-link" type="button" disabled={pageBusy} onClick={() => { setEditing(null); setConfirming(true); setError(""); }}>Cancel booking</button>
          )}
        </div>
      </footer>
      {canEdit && confirming && (
        <div className="mb-cancel-review">
          <h3>Cancel this reservation?</h3>
          <p id={`cancel-confirm-${booking.BookingID}`}>Cancel booking #{booking.BookingID}? This releases all reserved rooms.</p>
          <div className="mb-cancel-actions">
            <button className="mb-button mb-button-secondary" type="button" disabled={pageBusy} onClick={() => setConfirming(false)}>Keep booking</button>
            <button className="mb-button mb-button-danger" type="button" disabled={pageBusy} aria-describedby={`cancel-confirm-${booking.BookingID}`} onClick={cancel}>{pending ? "Cancelling…" : "Yes, cancel booking"}</button>
          </div>
        </div>
      )}
      {error && <p className="mb-error mb-card-error" role="alert">{error}</p>}
      {blocked && (
        <section className="mb-change-review" aria-labelledby={`change-review-${booking.BookingID}`}>
          <h3 id={`change-review-${booking.BookingID}`}>Review the current booking</h3>
          <p>{changeState?.kind === "unavailable"
            ? "We could not read the record of your last booking change. Further changes are paused. Refresh this page when browser storage is available."
            : detailsRead
              ? "The details above were loaded from your booking. Check the status, room, dates and guests before continuing. No earlier request will be sent again. If the result is unclear, ask hotel staff to check before making another change."
              : "A booking change needs checking. Load the current details before making another change."}</p>
          <div className="mb-editor-actions">
            <button className="mb-button mb-button-secondary" type="button" disabled={pageBusy} onClick={() => onRefresh()}>Load current details</button>
            {detailsRead && changeState && changeState.kind !== "unavailable" && (
              <button className="mb-button mb-button-primary" type="button" disabled={pageBusy} onClick={acknowledgeReview}>I have checked these details</button>
            )}
          </div>
        </section>
      )}
    </article>
  );
}

// Changes one room entry of a Booked reservation: dates, guest count or the room itself.
function RoomEditor({ booking, room, token, pageBusy, beginMutation, onFailure, onClose, onSaved }) {
  const uid = useId();
  const [form, setForm] = useState({
    checkin: room.CheckInDate,
    checkout: room.CheckOutDate,
    guests: room.GuestCount,
    roomId: room.RoomID,
  });
  const [alternatives, setAlternatives] = useState([]);
  const [selectedAlternative, setSelectedAlternative] = useState(null);
  const [lookup, setLookup] = useState({ loading: false, error: "", done: false });
  const [save, setSave] = useState({ pending: false, error: "" });
  const lookupRequest = useRef(null);
  const lookupVersion = useRef(0);
  const mutation = useRef(null);
  const busy = useRef(false);
  const today = getLocalToday();

  useEffect(() => () => {
    lookupVersion.current += 1;
    lookupRequest.current?.abort();
    mutation.current?.abort();
  }, []);

  const currentOption = {
    id: room.RoomID,
    label: `Room ${room.RoomNumber} · ${room.RoomTypeName} (current)`,
    capacity: room.Capacity,
    pricePerNight: Number(room.DailyRate),
  };
  const options = [
    currentOption,
    ...(selectedAlternative && !alternatives.some((item) => item.id === selectedAlternative.id) ? [selectedAlternative] : []),
    ...alternatives,
  ];
  const selected = form.roomId === room.RoomID ? currentOption : selectedAlternative;
  const disabled = pageBusy || save.pending;
  const nights = (Date.parse(`${form.checkout}T00:00:00Z`) - Date.parse(`${form.checkin}T00:00:00Z`)) / 86400000;
  const estimatedCharge = selected && Number.isInteger(nights) && nights > 0 && Number.isFinite(selected.pricePerNight)
    ? selected.pricePerNight * nights : null;

  function invalidateLookup() {
    lookupVersion.current += 1;
    lookupRequest.current?.abort();
    lookupRequest.current = null;
    setAlternatives([]);
    setLookup({ loading: false, error: "", done: false });
  }

  function change(name, value) {
    if (disabled || busy.current) return;
    setSave((current) => ({ ...current, error: "" }));
    if (name === "roomId") {
      const next = options.find((option) => option.id === Number(value));
      if (!next || next.capacity < form.guests) return;
      setSelectedAlternative(next.id === room.RoomID ? null : next);
      setForm((current) => ({ ...current, roomId: next.id }));
      return;
    }
    if (name === "guests" && (!Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > selected.capacity)) return;
    // Discard the old search, while retaining the room the guest explicitly chose.
    invalidateLookup();
    setForm((current) => ({ ...current, [name]: name === "guests" ? Number(value) : value }));
  }

  async function findRooms() {
    if (disabled || busy.current) return;
    invalidateLookup();
    let stay;
    try {
      stay = validateStay({ checkin: form.checkin, checkout: form.checkout, guests: form.guests });
    } catch (failure) {
      setLookup({ loading: false, error: failure.message, done: false });
      return;
    }
    const controller = new AbortController();
    const version = lookupVersion.current;
    lookupRequest.current = controller;
    setLookup({ loading: true, error: "", done: false });
    try {
      const rooms = await searchRooms({ ...stay, branchId: room.BranchID }, controller.signal);
      if (controller.signal.aborted || version !== lookupVersion.current || !isCurrentGuest(token)) return;
      setAlternatives(rooms.filter((item) => item.id !== room.RoomID && item.branchId === room.BranchID && item.capacity >= stay.guests).map((item) => ({
        id: item.id,
        label: `Room ${item.number} · ${item.roomType} · ${money.format(item.pricePerNight)} per night`,
        capacity: item.capacity,
        pricePerNight: item.pricePerNight,
      })));
      setLookup({ loading: false, error: "", done: true });
    } catch (failure) {
      if (controller.signal.aborted || version !== lookupVersion.current || !isCurrentGuest(token) || failure.name === "AbortError") return;
      setLookup({ loading: false, error: failure.message, done: false });
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (busy.current || disabled || lookup.loading || !isCurrentGuest(token)) return;
    const changes = { bookedRoomId: room.BookedRoomID };
    if (form.checkin !== room.CheckInDate) changes.checkin = form.checkin;
    if (form.checkout !== room.CheckOutDate) changes.checkout = form.checkout;
    if (form.guests !== room.GuestCount) changes.guestCount = form.guests;
    if (form.roomId !== room.RoomID) changes.roomId = form.roomId;
    if (Object.keys(changes).length === 1) {
      setSave({ pending: false, error: "Change at least one detail before saving." });
      return;
    }
    if (!selected || !Number.isSafeInteger(form.guests) || form.guests < 1 || form.guests > selected.capacity) {
      setSave({ pending: false, error: "Choose a guest count within this room's capacity." });
      return;
    }
    if (changes.checkin || changes.checkout) {
      try {
        validateStay({ checkin: form.checkin, checkout: form.checkout, guests: form.guests });
      } catch (failure) {
        setSave({ pending: false, error: failure.message });
        return;
      }
    }
    const release = beginMutation(booking.BookingID);
    if (!release) return;
    busy.current = true;
    invalidateLookup();
    const controller = new AbortController();
    mutation.current = controller;
    setSave({ pending: true, error: "" });
    try {
      await updateGuestBooking(booking.BookingID, changes, token, controller.signal);
      if (!controller.signal.aborted && isCurrentGuest(token)) {
        release();
        onSaved(`Booking #${booking.BookingID} was updated.`);
      }
    } catch (failure) {
      if (controller.signal.aborted || !isCurrentGuest(token) || failure.name === "AbortError") return;
      setSave({ pending: false, error: failure.message });
      onFailure(failure);
    } finally {
      release();
      busy.current = false;
    }
  }

  return (
    <form className="mb-room-editor" onSubmit={submit} noValidate aria-label={`Change room ${room.RoomNumber}`} aria-busy={save.pending}>
      {booking.rooms.length > 1 && (
        <p className="mb-editor-note">Only this room is changed. The other rooms in this booking keep their dates and guests.</p>
      )}
      <div className="mb-editor-grid">
        <div className="mb-editor-field">
          <label htmlFor={`${uid}-checkin`}>Check-in</label>
          <input id={`${uid}-checkin`} type="date" min={today} value={form.checkin} onChange={(event) => change("checkin", event.target.value)} disabled={disabled} />
        </div>
        <div className="mb-editor-field">
          <label htmlFor={`${uid}-checkout`}>Check-out</label>
          <input id={`${uid}-checkout`} type="date" min={form.checkin || today} value={form.checkout} onChange={(event) => change("checkout", event.target.value)} disabled={disabled} />
        </div>
        <div className="mb-editor-field">
          <label htmlFor={`${uid}-guests`}>Guests</label>
          <select id={`${uid}-guests`} value={form.guests} onChange={(event) => change("guests", event.target.value)} disabled={disabled}>
            {Array.from({ length: Math.max(selected?.capacity ?? room.Capacity, form.guests) }, (_, index) => index + 1).map((count) => (
              <option key={count} value={count}>{count}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="mb-editor-rooms">
        <div className="mb-editor-field">
          <label htmlFor={`${uid}-room`}>Room</label>
          <select id={`${uid}-room`} value={form.roomId} onChange={(event) => change("roomId", event.target.value)} disabled={disabled}>
            {options.map((option) => <option key={option.id} value={option.id} disabled={option.capacity < form.guests}>{option.label}{option.capacity < form.guests ? ` · maximum ${option.capacity} guests` : ""}</option>)}
          </select>
        </div>
        <button className="mb-button mb-button-secondary" type="button" onClick={findRooms} disabled={lookup.loading || disabled}>
          {lookup.loading ? "Searching…" : "Find other rooms for these dates"}
        </button>
      </div>
      {lookup.error && <p className="mb-error" role="alert">{lookup.error}</p>}
      {lookup.done && !alternatives.length && (
        <p className="mb-editor-note" role="status">No other rooms at {room.BranchName} are available for these dates and guests.</p>
      )}
      {estimatedCharge !== null && <p className="mb-editor-estimate">Estimated charge for this room: <strong>{money.format(estimatedCharge)}</strong><span>{nights} {nights === 1 ? "night" : "nights"}. Services and other charges are excluded.</span></p>}
      <p className="mb-editor-note">Your selected room is kept when you change dates or guests. Availability is checked when you save; prices can change before check-in.</p>
      {save.error && <p className="mb-error mb-card-error" role="alert">{save.error}</p>}
      <div className="mb-editor-actions">
        <button className="mb-button mb-button-secondary" type="button" onClick={onClose} disabled={disabled}>Keep current details</button>
        <button className="mb-button mb-button-primary" type="submit" disabled={disabled || lookup.loading}>{save.pending ? "Saving…" : "Save changes"}</button>
      </div>
    </form>
  );
}

function StayIcon() {
  return (
    <svg className="mb-stay-icon" width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden="true">
      <path d="M7 37V12h30v25M4 37h36M15 12V7h14v5M18 37V26h8v11M13 18h3m12 0h3m-18 5h3m12 0h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
