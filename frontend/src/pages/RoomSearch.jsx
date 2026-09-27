import { useEffect, useRef, useState } from "react";
import {
  demoBranches,
  demoRoomTypes,
  demoRooms,
} from "../data/demoRooms";

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

function getLocalToday() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export default function RoomSearch() {
  const [filters, setFilters] = useState(initialFilters);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const today = getLocalToday();
  const [selectedRoomId, setSelectedRoomId] = useState("");
const reviewRef = useRef(null);
const selectedButtonRef = useRef(null);

const selectedRoom = result?.rooms.find(
  (room) => room.id === selectedRoomId
);

useEffect(() => {
  if (selectedRoomId && reviewRef.current) {
    reviewRef.current.focus({ preventScroll: true });
    reviewRef.current.scrollIntoView({ block: "start" });
  }
}, [selectedRoomId]);

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
  setSelectedRoomId("");
}

  function handleChange(event) {
    const { name, value } = event.target;

    setFilters((current) => ({
      ...current,
      [name]: value,
    }));

    setError("");
    setResult(null);
    setSelectedRoomId("");
  }

  function handleSearch(event) {
    event.preventDefault();
    setError("");
    setResult(null);
    setSelectedRoomId("");

    if (!filters.checkin || !filters.checkout) {
      setError("Please choose your check-in and check-out dates.");
      return;
    }

    if (filters.checkin < getLocalToday()) {
      setError("Check-in cannot be earlier than today.");
      return;
    }

    // UTC midnight keeps the calculation based on whole calendar days.
    const arrival = Date.parse(`${filters.checkin}T00:00:00Z`);
    const departure = Date.parse(`${filters.checkout}T00:00:00Z`);
    const nights = (departure - arrival) / 86400000;

    if (!Number.isInteger(nights) || nights < 1) {
      setError("Check-out must be after check-in.");
      return;
    }

    const guests = Number(filters.guests);

    if (!Number.isInteger(guests) || guests < 1) {
      setError("Enter a whole number of guests, starting from 1.");
      return;
    }

    const matchingRooms = demoRooms.filter((room) => {
      const matchesBranch =
        filters.branch === "" || room.branch === filters.branch;

      const matchesType =
        filters.roomType === "" ||
        room.roomType === filters.roomType;

      const fitsGuests = room.capacity >= guests;

      return matchesBranch && matchesType && fitsGuests;
    });

    setResult({
    rooms: matchingRooms,
    nights,
    checkin: filters.checkin,
    checkout: filters.checkout,
    guests,
    });
  }

  return (
    <section aria-labelledby="room-search-heading">
      <p className="eyebrow">PLAN YOUR STAY</p>
      <h1 id="room-search-heading">Find a room</h1>
      <p>Choose your destination, dates and number of guests.</p>

      <p className="room-demo-note">
        Preview: rooms and prices are sample data. Dates are used
        to estimate room charges; actual availability is not checked.
      </p>

      <form className="room-search-form" onSubmit={handleSearch}>
        <div className="form-field">
          <label htmlFor="room-branch">Branch</label>
          <select
            id="room-branch"
            name="branch"
            value={filters.branch}
            onChange={handleChange}
          >
            <option value="">All branches</option>
            {demoBranches.map((branch) => (
              <option key={branch} value={branch}>
                {branch}
              </option>
            ))}
          </select>
        </div>

        <div className="form-field">
          <label htmlFor="room-type">Room type</label>
          <select
            id="room-type"
            name="roomType"
            value={filters.roomType}
            onChange={handleChange}
          >
            <option value="">All room types</option>
            {demoRoomTypes.map((type) => (
              <option key={type} value={type}>
                {type}
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

        <button className="button" type="submit">
          Search sample rooms
        </button>
      </form>

      <p className="room-search-summary" role="status">
        {result === null
          ? "Submit your search to view matching sample rooms."
          : `${result.rooms.length} sample room(s) match your search for ${
              result.nights
            } night${result.nights === 1 ? "" : "s"}.`}
      </p>

      {result && result.rooms.length === 0 && (
        <p>
          No sample rooms match these filters. Try another branch,
          room type or guest count.
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
      Sample preview only. No room has been reserved.
    </p>

    <button
      className="button"
      type="button"
      onClick={handleClearSelection}
    >
      Clear selection
    </button>
  </section>
)}
    </section>
  );
}