import { useEffect, useRef, useState } from "react";
import { getLocalToday, loadRoomOptions, searchRooms, validateStay } from "../services/roomApi";
import "./RoomSearch.css";
import { Link, useLocation, useNavigate } from "react-router";
import { MAX_ROOMS, selectedGuest } from "../services/bookingIntent";
import { isCurrentStaff, loadStaffRoomOptions, searchStaffRooms } from "../services/staffGuestBookingApi";

const initialFilters = {
  branch: "",
  roomType: "",
  checkin: "",
  checkout: "",
  guests: "1",
};

function initialRoomFilters(navigationState) {
  const stay = navigationState?.roomSearch;
  if (!stay || typeof stay !== "object" || Object.getPrototypeOf(stay) !== Object.prototype) return initialFilters;
  const positiveInteger = (value) => typeof value === "string" && /^[1-9]\d*$/.test(value)
    && Number.isSafeInteger(Number(value));
  const date = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
  return {
    ...initialFilters,
    branch: positiveInteger(stay.branchId) ? stay.branchId : "",
    checkin: date(stay.checkin),
    checkout: date(stay.checkout),
    guests: positiveInteger(stay.guests) ? stay.guests : "1",
  };
}

const money = new Intl.NumberFormat("en-LK", {
  style: "currency",
  currency: "LKR",
  currencyDisplay: "code",
});

function roomPhoto(roomType) {
  const name = roomType.toLowerCase();
  if (name.includes("family") || name.includes("double")) return "/images/hotel/room-family.jpg";
  if (name.includes("deluxe") || name.includes("suite")) return "/images/hotel/room-deluxe.jpg";
  if (name.includes("standard") || name.includes("single")) return "/images/hotel/room-standard.jpg";
  return null;
}

function RoomIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M7 34V19m34 15V19M7 28h34M7 34h34M10 28V16a3 3 0 0 1 3-3h22a3 3 0 0 1 3 3v12M12 34v5m24-5v5" />
      <path d="M14 27v-5a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v5m2 0v-5a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v5" />
    </svg>
  );
}

export default function RoomSearch({ staffSession }) {
  const location = useLocation();
  const navigate = useNavigate();
  // Public room searches never inherit staff identity from navigation state.
  const staffRoute = location.pathname === "/staff/bookings/rooms";
  const staffToken = staffRoute ? staffSession?.token : null;
  const bookingFor = staffToken ? selectedGuest(location.state?.bookingFor) : null;
  const selectedGuestId = bookingFor?.guestId;
  const [filters, setFilters] = useState(() => initialRoomFilters(location.state));
  const [options, setOptions] = useState({ branches: [], roomTypes: [], scope: null });
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState("");
  const [optionsAttempt, setOptionsAttempt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  // One entry per room added to the booking: { id, guests }.
  const [selectedRooms, setSelectedRooms] = useState([]);
  const searchRequest = useRef(null);
  const searchVersion = useRef(0);
  const reviewRef = useRef(null);
  const today = getLocalToday();
  const scope = options.scope;
  const assignedBranch = staffRoute && scope?.role === "Receptionist";
  const verifiedStaff = !staffRoute || Boolean(scope && bookingFor && isCurrentStaff(staffToken));

  const selectedItems = result
    ? selectedRooms
      .map(({ id, guests }) => ({ room: result.rooms.find((room) => room.id === id), guests }))
      .filter((item) => item.room)
    : [];
  const selectedTotal = result
    ? selectedItems.reduce((sum, { room }) => sum + room.pricePerNight * result.nights, 0)
    : 0;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    if (staffRoute && (!staffToken || !selectedGuestId)) {
      return () => { active = false; controller.abort(); };
    }
    const load = staffRoute
      ? loadStaffRoomOptions(staffToken, controller.signal)
      : loadRoomOptions(controller.signal);
    load.then((data) => {
      if (!active || controller.signal.aborted) return;
      if (staffRoute && !isCurrentStaff(staffToken)) {
        setOptionsError("Your staff session has changed. Please sign in again.");
        return;
      }
      setOptions(data);
      setFilters((current) => data.scope?.role === "Receptionist"
        ? { ...current, branch: String(data.scope.branchId) }
        : current.branch && !data.branches.some((branch) => String(branch.id) === current.branch)
          ? { ...current, branch: "" }
          : current);
    }).catch((failure) => {
      if (active && !controller.signal.aborted) {
        setOptionsError(failure.name === "AbortError"
          ? "Your staff session has changed. Please sign in again."
          : failure.message);
      }
    })
      .finally(() => { if (active) setOptionsLoading(false); });
    return () => {
      active = false;
      controller.abort();
    };
  }, [optionsAttempt, staffRoute, staffToken, selectedGuestId]);

  useEffect(() => () => {
    searchVersion.current += 1;
    searchRequest.current?.abort();
  }, []);

  function retryOptions() {
    setOptionsLoading(true);
    setOptionsError("");
    setOptionsAttempt((attempt) => attempt + 1);
  }

  function toggleRoom(room) {
    setSelectedRooms((current) => {
      if (current.some((item) => item.id === room.id)) return current.filter((item) => item.id !== room.id);
      if (current.length >= MAX_ROOMS) return current;
      return [...current, { id: room.id, guests: Math.min(result.guests, room.capacity) }];
    });
  }

  function setRoomGuests(roomId, value) {
    setSelectedRooms((current) => current.map((item) => item.id === roomId ? { ...item, guests: Number(value) } : item));
  }

  function scrollToReview() {
    reviewRef.current?.focus({ preventScroll: true });
    reviewRef.current?.scrollIntoView({ block: "start" });
  }

  function clearSearch() {
    searchVersion.current += 1;
    searchRequest.current?.abort();
    searchRequest.current = null;
    setLoading(false);
    setError("");
    setResult(null);
    setSelectedRooms([]);
  }

  function handleChange(event) {
    const { name, value } = event.target;
    if (name === "branch" && assignedBranch) return;
    clearSearch();
    setFilters((current) => ({ ...current, [name]: value }));
  }

  function clearFilters() {
    clearSearch();
    setFilters({ ...initialFilters, branch: assignedBranch ? String(scope.branchId) : "" });
  }

  async function handleSearch(event) {
    event?.preventDefault();
    clearSearch();
    if (optionsLoading || optionsError || !verifiedStaff) {
      setError("Wait until your booking access and room filters have been checked.");
      return;
    }
    let stay;
    try {
      stay = validateStay(filters);
    } catch (failure) {
      setError(failure.message);
      return;
    }
    const controller = new AbortController();
    const version = searchVersion.current;
    searchRequest.current = controller;
    setLoading(true);
    try {
      const query = { ...stay, branchId: filters.branch, roomTypeId: filters.roomType };
      if (staffRoute) {
        const data = await searchStaffRooms(query, staffToken, controller.signal);
        if (version !== searchVersion.current || controller.signal.aborted) return;
        if (!isCurrentStaff(staffToken)) {
          setError("Your staff session has changed. Please sign in again.");
          return;
        }
        setOptions((current) => ({ ...current, scope: data.scope }));
        if (data.scope.role === "Receptionist") {
          setFilters((current) => ({ ...current, branch: String(data.scope.branchId) }));
        }
        setResult({ ...stay, rooms: data.rooms });
      } else {
        const rooms = await searchRooms(query, controller.signal);
        if (version === searchVersion.current) setResult({ ...stay, rooms });
      }
    } catch (failure) {
      if (version === searchVersion.current && !controller.signal.aborted) {
        setError(failure.name === "AbortError"
          ? "Your staff session has changed. Please sign in again."
          : failure.message);
      }
    } finally {
      if (version === searchVersion.current) {
        setLoading(false);
        searchRequest.current = null;
      }
    }
  }

  function continueToBooking() {
    if (!result || selectedItems.length === 0 || !verifiedStaff) return;
    navigate(staffRoute ? "/staff/make-booking" : "/make-booking", {
      state: {
        stay: {
          checkin: result.checkin,
          checkout: result.checkout,
          rooms: selectedItems.map(({ room, guests }) => ({ roomId: room.id, guests })),
        },
        ...(staffRoute ? { guest: bookingFor } : {}),
      },
    });
  }

  const roomCount = selectedItems.length;

  if (staffRoute && (!bookingFor || !isCurrentStaff(staffToken))) {
    return (
      <section className="room-search-page" aria-labelledby="staff-room-start-heading">
        <div className="room-search-placeholder">
          <span className="room-placeholder-icon"><RoomIcon /></span>
          <div>
            <p className="eyebrow">FRONT DESK</p>
            <h1 id="staff-room-start-heading">Choose a guest first</h1>
            <p>Start from the booking workspace to select the guest for this reservation.</p>
            <Link className="button" to="/staff/bookings/new">Choose a guest</Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="room-search-page" aria-labelledby="room-search-heading">
      <header className="room-page-intro">
        <div className="room-intro-copy">
          <p className="eyebrow">{staffRoute ? "FRONT DESK" : "PLAN YOUR STAY"}</p>
          <h1 id="room-search-heading">{staffRoute ? <>Find rooms.<br /><em>Plan their stay.</em></> : <>Find a room.<br /><em>Make it your own.</em></>}</h1>
          <p>{staffRoute ? "Choose dates and rooms for your guest, then review the stay before confirming." : "Choose your destination, dates and number of guests. Your next Sri Lankan stay begins here."}</p>
        </div>
        <div className="room-intro-image">
          <img src="/images/hotel/room-deluxe.jpg" alt="" />
          <span>SPACE TO SLOW DOWN</span>
        </div>
      </header>
      <p className="room-photograph-note">Room photographs are illustrative.</p>

      {optionsLoading && <p role="status">Loading branches and room types…</p>}
      {optionsError && (
        <div>
          <p className="form-error" role="alert">{optionsError}</p>
          <button className="button" type="button" onClick={retryOptions}>
            Retry loading filters
          </button>
        </div>
      )}

      {bookingFor && (
        <p className="room-demo-note" role="status">
          Booking for <strong>{bookingFor.name}</strong> · <Link to="/staff/bookings/new">Change guest</Link>
        </p>
      )}
      <form className="room-search-form" onSubmit={handleSearch}>
        <div className="room-form-heading">
          <div>
            <p className="eyebrow">THE DETAILS</p>
            <h2>Tell us about your stay</h2>
          </div>
          <span className="room-form-heading-note">A place. A date. A little time away.</span>
        </div>
        <div className="form-field">
          <label htmlFor="room-branch">{assignedBranch ? "Assigned branch" : "Branch"}</label>
          <select
            id="room-branch"
            name="branch"
            disabled={optionsLoading || Boolean(optionsError) || Boolean(assignedBranch)}
            value={filters.branch}
            onChange={handleChange}
          >
            {assignedBranch
              ? <option value={scope.branchId}>{scope.branchName}</option>
              : <><option value="">All branches</option>
                {options.branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}</>}
          </select>
          {assignedBranch && <p className="room-scope-note">Bookings are limited to your assigned branch, including after clearing filters.</p>}
        </div>

        <div className="form-field">
          <label htmlFor="room-type">Room type</label>
          <select
            id="room-type"
            name="roomType"
            disabled={optionsLoading || Boolean(optionsError)}
            value={filters.roomType}
            onChange={handleChange}
          >
            <option value="">All room types</option>
            {options.roomTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </div>

        <div className="form-field">
          <label htmlFor="room-guests">Guests in one room</label>
          <input
            id="room-guests"
            name="guests"
            type="number"
            min="1"
            step="1"
            value={filters.guests}
            onChange={handleChange}
            required
          />
        </div>

        <div className="form-field">
          <label htmlFor="room-checkin">Check-in</label>
          <input
            id="room-checkin"
            name="checkin"
            type="date"
            min={today}
            value={filters.checkin}
            onChange={handleChange}
            required
          />
        </div>

        <div className="form-field">
          <label htmlFor="room-checkout">Check-out</label>
          <input
            id="room-checkout"
            name="checkout"
            type="date"
            min={filters.checkin || today}
            value={filters.checkout}
            onChange={handleChange}
            required
          />
        </div>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <button className="button room-search-submit" type="submit" disabled={loading || optionsLoading || Boolean(optionsError) || !verifiedStaff}>
          <span>{loading ? "Searching…" : error ? "Try search again" : "Search rooms"}</span>
          <span aria-hidden="true">↗</span>
        </button>
        {staffRoute && <button className="button room-reset-filters" type="button" onClick={clearFilters} disabled={optionsLoading || Boolean(optionsError)}>Clear filters</button>}
        <p className="room-demo-note room-form-notice">
          Room availability and prices are checked for your selected dates.
          Selecting a room does not reserve it. You can add up to {MAX_ROOMS} rooms to one booking.
        </p>
      </form>

      <div className="room-results-heading">
      <h2>{result ? "Rooms for your stay" : "A room to look forward to"}</h2>
      <p className="room-search-summary" role="status">
        {loading
          ? "Checking room availability…"
          : result === null
          ? "Submit your search to view rooms available for your stay."
          : `${result.rooms.length} room(s) available for ${
              result.nights
            } night${result.nights === 1 ? "" : "s"}.`}
      </p>
      </div>

      {!loading && result === null && (
        <div className="room-search-placeholder">
          <span className="room-placeholder-icon"><RoomIcon /></span>
          <div>
            <h3>Let’s find your place</h3>
            <p>Enter your stay details above to explore available rooms and prices.</p>
          </div>
        </div>
      )}

      {result && result.rooms.length === 0 && (
        <p className="room-empty-state">
          No rooms are available for these filters and dates. Try another branch,
          room type, date range or guest count.
        </p>
      )}

      {result && (
        <div className="card-grid">
          {result.rooms.map((room) => {
            const picked = selectedRooms.some((item) => item.id === room.id);
            const full = !picked && selectedRooms.length >= MAX_ROOMS;
            return (
              <article className={`card room-card${picked ? " room-card-selected" : ""}`} key={room.id}>
                <div className={`room-card-image${roomPhoto(room.roomType) ? "" : " room-card-image-placeholder"}`}>
                  {roomPhoto(room.roomType) ? (
                    <img src={roomPhoto(room.roomType)} alt="" loading="lazy" />
                  ) : <RoomIcon />}
                  <span className="room-number">ROOM {room.number}</span>
                </div>
                <div className="room-card-content">
                  <p className="room-card-branch">{room.branch}</p>
                  <h2>{room.roomType}</h2>
                  <p className="room-capacity"><span aria-hidden="true">◦</span> Maximum guests: {room.capacity}</p>

                  <p className="room-price">
                    {money.format(room.pricePerNight)}
                    <span> per night</span>
                  </p>

                  <p className="room-estimate">
                    Estimated room charge:{" "}
                    <strong>
                      {money.format(room.pricePerNight * result.nights)}
                    </strong>
                  </p>

                  <p className="room-charge-note">
                    Services and other charges are excluded.
                  </p>
                  <button
                    className="button"
                    type="button"
                    aria-pressed={picked}
                    disabled={full}
                    aria-label={`${picked ? "Remove" : "Add"} ${room.branch}, room ${room.number} ${picked ? "from" : "to"} your booking`}
                    onClick={() => toggleRoom(room)}
                  >
                    <span>{picked ? "Remove from booking" : "Add to booking"}</span>
                    <span aria-hidden="true">{picked ? "−" : "+"}</span>
                  </button>

                  {picked && <p className="room-selected-label">Added to your booking</p>}
                  {full && <p className="room-selected-label">A booking can have up to {MAX_ROOMS} rooms.</p>}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {result && roomCount > 0 && (
        <div className="room-selection-bar" role="status">
          <span>
            <strong>{roomCount} {roomCount === 1 ? "room" : "rooms"} selected</strong>
            {" · "}{money.format(selectedTotal)}
          </span>
          <button className="button" type="button" onClick={scrollToReview}>Review selection</button>
        </div>
      )}

      {result && roomCount > 0 && (
        <section
          className="stay-review"
          ref={reviewRef}
          tabIndex={-1}
          aria-labelledby="stay-review-heading"
        >
          <p className="eyebrow">YOUR SELECTION</p>
          <h2 id="stay-review-heading">Review your stay</h2>

          <p>
            <strong>{roomCount} {roomCount === 1 ? "room" : "rooms"} for {result.nights} night{result.nights === 1 ? "" : "s"}</strong>
          </p>

          <dl className="stay-details">
            <div>
              <dt>Check-in</dt>
              <dd>{result.checkin}</dd>
            </div>
            <div>
              <dt>Check-out</dt>
              <dd>{result.checkout}</dd>
            </div>
            <div>
              <dt>Nights</dt>
              <dd>{result.nights}</dd>
            </div>
          </dl>

          <ul className="room-selection-list">
            {selectedItems.map(({ room, guests }) => (
              <li className="room-selection-item" key={room.id}>
                <div className="room-selection-info">
                  <strong>{room.branch} · {room.roomType}</strong>
                  <span>Room {room.number} · {money.format(room.pricePerNight)} per night</span>
                </div>
                <div className="room-selection-guests">
                  <label htmlFor={`room-guests-${room.id}`}>Guests</label>
                  <select
                    id={`room-guests-${room.id}`}
                    value={guests}
                    onChange={(event) => setRoomGuests(room.id, event.target.value)}
                  >
                    {Array.from({ length: room.capacity }, (_, index) => index + 1).map((count) => (
                      <option key={count} value={count}>{count}</option>
                    ))}
                  </select>
                </div>
                <span className="room-selection-price">{money.format(room.pricePerNight * result.nights)}</span>
                <button
                  className="button room-clear-selection"
                  type="button"
                  aria-label={`Remove room ${room.number} from your booking`}
                  onClick={() => toggleRoom(room)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>

          <p className="room-price">
            Estimated room charge: {money.format(selectedTotal)}
          </p>

          <p className="room-charge-note">
            Services and other charges are excluded.
          </p>

          <p className="room-demo-note">
            No room has been reserved. Availability and prices can change before a booking is confirmed.
          </p>

          <div className="room-review-actions">
            <button
              className="button room-clear-selection"
              type="button"
              onClick={() => setSelectedRooms([])}
            >
              Clear selection
            </button>

            <button className="button" type="button" onClick={continueToBooking} disabled={!verifiedStaff}>
              Continue to booking review
            </button>
          </div>
        </section>
      )}
    </section>
  );
}
