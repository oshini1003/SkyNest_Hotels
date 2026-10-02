import { useState } from "react";

const bookingStatuses = [
  "Booked",
  "Checked-In",
  "Checked-Out",
  "Cancelled",
];

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function formatDate(value) {
  return dateFormatter.format(new Date(`${value}T00:00:00Z`));
}

export default function GuestBookings({ bookings, isPreview = false }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const query = search.trim().toLowerCase();

  const matchingBookings = bookings.filter((booking) => {
    const matchesStatus =
      statusFilter === "" || booking.status === statusFilter;

    const searchableText =
      `${booking.reference} ${booking.branch}`.toLowerCase();

    return matchesStatus && searchableText.includes(query);
  });

  function clearFilters() {
    setSearch("");
    setStatusFilter("");
  }

  return (
    <section aria-labelledby="bookings-heading">
      <p className="eyebrow">YOUR STAYS</p>

      <h1 id="bookings-heading">
        {isPreview ? "Sample bookings" : "My bookings"}
      </h1>

      <p>View booking dates, rooms and reservation status.</p>

      {isPreview && (
        <p className="booking-notice">
          Preview only: these are fixed example bookings, not real
          reservations. Your room-search selection does not create a
          booking here.
        </p>
      )}

      <div className="booking-filters">
        <div className="form-field">
          <label htmlFor="booking-search">
            Search bookings
          </label>

          <input
            id="booking-search"
            type="search"
            placeholder="Booking reference or branch"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="form-field">
          <label htmlFor="booking-status">
            Booking status
          </label>

          <select
            id="booking-status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="">All statuses</option>

            {bookingStatuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>

        <button
          className="button"
          type="button"
          onClick={clearFilters}
          disabled={search === "" && statusFilter === ""}
        >
          Clear filters
        </button>
      </div>

      <p className="booking-count" role="status">
        {matchingBookings.length}{" "}
        {isPreview ? "sample " : ""}
        {matchingBookings.length === 1 ? "booking" : "bookings"} found.
      </p>

      {matchingBookings.length === 0 ? (
        <p>
          {bookings.length === 0
            ? "There are no bookings to display."
            : "No bookings match your filters. Try another search or clear the filters."}
        </p>
      ) : (
        <div className="card-grid">
          {matchingBookings.map((booking) => (
            <article
              className="card booking-card"
              key={booking.reference}
            >
              <div className="booking-card-header">
                <h2>{booking.reference}</h2>

                <span
                  className="booking-status"
                  data-status={booking.status}
                >
                  {booking.status}
                </span>
              </div>

              <p className="booking-branch">
                SkyNest {booking.branch}
              </p>

              <p className="booking-dates">
                <time dateTime={booking.checkin}>
                  {formatDate(booking.checkin)}
                </time>
                {" – "}
                <time dateTime={booking.checkout}>
                  {formatDate(booking.checkout)}
                </time>
              </p>

              <details className="booking-details">
                <summary>
                  View booking details
                  <span className="booking-sr-only">
                    {" "}for {booking.reference}
                  </span>
                </summary>

                <dl>
                  <div>
                    <dt>Check-in</dt>
                    <dd>{formatDate(booking.checkin)}</dd>
                  </div>

                  <div>
                    <dt>Check-out</dt>
                    <dd>{formatDate(booking.checkout)}</dd>
                  </div>

                  <div>
                    <dt>Guests</dt>
                    <dd>{booking.guests}</dd>
                  </div>

                  <div>
                    <dt>Number of rooms</dt>
                    <dd>{booking.rooms.length}</dd>
                  </div>
                </dl>

                <h3>Rooms in this booking</h3>

                <ul className="booking-room-list">
                  {booking.rooms.map((room) => (
                    <li key={room.number}>
                      Room {room.number} — {room.roomType}
                    </li>
                  ))}
                </ul>
              </details>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}