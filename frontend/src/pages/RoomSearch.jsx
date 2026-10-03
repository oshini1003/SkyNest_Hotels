import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { getLocalToday, loadRoomOptions, searchRooms, validateStay } from "../services/roomApi";

const initialFilters = {
  branch: "",
  roomType: "",
  checkin: "",
  checkout: "",
  guests: "1",
};

const money = new Intl.NumberFormat("en-LK", {
  style: "currency",
  currency: "LKR",
  currencyDisplay: "code",
});

export default function RoomSearch() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState(initialFilters);
  const [options, setOptions] = useState({ branches: [], roomTypes: [] });
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState("");
  const [optionsAttempt, setOptionsAttempt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [selectedRoomId, setSelectedRoomId] = useState(null);
  const searchRequest = useRef(null);
  const searchVersion = useRef(0);
  const reviewRef = useRef(null);
  const selectedButtonRef = useRef(null);
  const today = getLocalToday();
  const selectedRoom = result?.rooms.find((room) => room.id === selectedRoomId);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    loadRoomOptions(controller.signal)
      .then((data) => { if (active) setOptions(data); })
      .catch((failure) => {
        if (active && failure.name !== "AbortError") setOptionsError(failure.message);
      })
      .finally(() => { if (active) setOptionsLoading(false); });
    return () => {
      active = false;
      controller.abort();
    };
  }, [optionsAttempt]);

  useEffect(() => () => {
    searchVersion.current += 1;
    searchRequest.current?.abort();
  }, []);

  useEffect(() => {
    if (selectedRoomId && reviewRef.current) {
      reviewRef.current.focus({ preventScroll: true });
      reviewRef.current.scrollIntoView({ block: "start" });
    }
  }, [selectedRoomId]);

  function retryOptions() {
    setOptionsLoading(true);
    setOptionsError("");
    setOptionsAttempt((attempt) => attempt + 1);
  }

  function handleSelectRoom(roomId, event) {
    selectedButtonRef.current = event.currentTarget;
    if (selectedRoomId === roomId) {
      reviewRef.current?.focus({ preventScroll: true });
      reviewRef.current?.scrollIntoView({ block: "start" });
      return;
    }
    setSelectedRoomId(roomId);
  }

  function handleClearSelection() {
    selectedButtonRef.current?.focus();
    setSelectedRoomId(null);
  }

  function clearSearch() {
    searchVersion.current += 1;
    searchRequest.current?.abort();
    searchRequest.current = null;
    setLoading(false);
    setError("");
    setResult(null);
    setSelectedRoomId(null);
    selectedButtonRef.current = null;
  }

  function handleChange(event) {
    const { name, value } = event.target;
    clearSearch();
    setFilters((current) => ({ ...current, [name]: value }));
  }

  async function handleSearch(event) {
    event?.preventDefault();
    clearSearch();
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
      const rooms = await searchRooms({
        ...stay,
        branchId: filters.branch,
        roomTypeId: filters.roomType,
      }, controller.signal);
      if (version === searchVersion.current) setResult({ ...stay, rooms });
    } catch (failure) {
      if (version === searchVersion.current && failure.name !== "AbortError") setError(failure.message);
    } finally {
      if (version === searchVersion.current) {
        setLoading(false);
        searchRequest.current = null;
      }
    }
  }

  return (
    <section aria-labelledby="room-search-heading">
      <p className="eyebrow">PLAN YOUR STAY</p>
      <h1 id="room-search-heading">Find a room</h1>
      <p>Choose your destination, dates and number of guests.</p>

      <p className="room-demo-note">
        Room availability and prices are checked for your selected dates.
        Selecting a room does not reserve it.
      </p>

      {optionsLoading && <p role="status">Loading branches and room types…</p>}
      {optionsError && (
        <div>
          <p className="form-error" role="alert">{optionsError}</p>
          <button className="button" type="button" onClick={retryOptions}>
            Retry loading filters
          </button>
        </div>
      )}

      <form className="room-search-form" onSubmit={handleSearch}>
        <div className="form-field">
          <label htmlFor="room-branch">Branch</label>
          <select
            id="room-branch"
            name="branch"
            disabled={optionsLoading || Boolean(optionsError)}
            value={filters.branch}
            onChange={handleChange}
          >
            <option value="">All branches</option>
            {options.branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
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

        <button className="button" type="submit" disabled={loading || optionsLoading || Boolean(optionsError)}>
          {loading ? "Searching…" : error ? "Try search again" : "Search rooms"}
        </button>
      </form>

      <p className="room-search-summary" role="status">
        {loading
          ? "Checking room availability…"
          : result === null
          ? "Submit your search to view rooms available for your stay."
          : `${result.rooms.length} room(s) available for ${
              result.nights
            } night${result.nights === 1 ? "" : "s"}.`}
      </p>

      {result && result.rooms.length === 0 && (
        <p>
          No rooms are available for these filters and dates. Try another branch,
          room type, date range or guest count.
        </p>
      )}

      {result && (
        <div className="card-grid">
          {result.rooms.map((room) => (
            <article className="card room-card" key={room.id}>
              <h2>{room.roomType}</h2>

              <p>
                {room.branch} · Room {room.number}
              </p>

              <p>Maximum guests: {room.capacity}</p>

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
                aria-pressed={selectedRoomId === room.id}
                aria-label={`Review this room: ${room.branch}, room ${room.number}`}
                onClick={(event) => handleSelectRoom(room.id, event)}
                >
                Review this room
                </button>

                {selectedRoomId === room.id && (
                <p className="room-selected-label">Selected for review</p>
                )}
            </article>
          ))}
        </div>
      )}
      {result && selectedRoom && (
  <section
    className="stay-review"
    ref={reviewRef}
    tabIndex={-1}
    aria-labelledby="stay-review-heading"
  >
    <p className="eyebrow">YOUR SELECTION</p>
    <h2 id="stay-review-heading">Review your stay</h2>

    <p>
      <strong>
        {selectedRoom.branch} · {selectedRoom.roomType}
      </strong>
    </p>

    <dl className="stay-details">
      <div>
        <dt>Room number</dt>
        <dd>{selectedRoom.number}</dd>
      </div>

      <div>
        <dt>Check-in</dt>
        <dd>{result.checkin}</dd>
      </div>

      <div>
        <dt>Check-out</dt>
        <dd>{result.checkout}</dd>
      </div>

      <div>
        <dt>Guests</dt>
        <dd>{result.guests}</dd>
      </div>

      <div>
        <dt>Nights</dt>
        <dd>{result.nights}</dd>
      </div>

      <div>
        <dt>Price per night</dt>
        <dd>{money.format(selectedRoom.pricePerNight)}</dd>
      </div>
    </dl>

    <p className="room-price">
      Estimated room charge:{" "}
      {money.format(selectedRoom.pricePerNight * result.nights)}
    </p>

    <p className="room-charge-note">
      Services and other charges are excluded.
    </p>

    <p className="room-demo-note">
      No room has been reserved. Availability and prices can change before a booking is confirmed.
    </p>
    

    <div style={{ display: "flex", gap: "10px", marginTop: "1rem" }}>
      <button
        className="button"
        type="button"
        onClick={handleClearSelection}
      >
        Clear selection
      </button>

      <button
        className="button"
        type="button"
        onClick={() =>
          navigate("/make-booking", {
            state: {
              stay: {
                roomId: selectedRoom.id,
                checkin: result.checkin,
                checkout: result.checkout,
                guests: result.guests,
              },
            },
          })
        }
      >
        Continue to booking review
      </button>
    </div>
  </section>
)}
    </section>
  );
}
