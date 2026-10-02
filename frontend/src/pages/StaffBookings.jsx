import { useState } from "react";
import { Link } from "react-router";

const statuses = [
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

export default function StaffBookings({
  bookings,
  isPreview = false,
}) {
  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const branches = [
    ...new Set(bookings.map((booking) => booking.branch)),
  ];

  const query = search.trim().toLowerCase();

  const matchingBookings = bookings.filter((booking) => {
    const matchesBranch =
      branchFilter === "" || booking.branch === branchFilter;

    const matchesStatus =
      statusFilter === "" || booking.status === statusFilter;

    const roomNumbers = booking.rooms
      .map((room) => room.number)
      .join(" ");

    const searchableText = [
      booking.reference,
      booking.guestName,
      booking.branch,
      roomNumbers,
    ]
      .join(" ")
      .toLowerCase();

    return (
      matchesBranch &&
      matchesStatus &&
      searchableText.includes(query)
    );
  });

  function clearFilters() {
    setSearch("");
    setBranchFilter("");
    setStatusFilter("");
  }

  return (
    <section aria-labelledby="staff-bookings-heading">
      <p className="eyebrow">STAFF WORKSPACE</p>

      <h1 id="staff-bookings-heading">Staff bookings</h1>

      <p>
        Find reservations by booking reference, guest, branch or room.
      </p>

      {isPreview && (
        <p className="booking-notice">
          Development preview: these are sample bookings.
          No bookings can be changed here.
        </p>
      )}

      <div className="staff-booking-filters">
        <div className="form-field">
          <label htmlFor="staff-booking-search">
            Search bookings
          </label>

          <input
            id="staff-booking-search"
            type="search"
            placeholder="Reference, guest or room"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="form-field">
          <label htmlFor="staff-booking-branch">
            Branch
          </label>

          <select
            id="staff-booking-branch"
            value={branchFilter}
            onChange={(event) => setBranchFilter(event.target.value)}
          >
            <option value="">All branches</option>

            {branches.map((branch) => (
              <option key={branch} value={branch}>
                {branch}
              </option>
            ))}
          </select>
        </div>

        <div className="form-field">
          <label htmlFor="staff-booking-status">
            Status
          </label>

          <select
            id="staff-booking-status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="">All statuses</option>

            {statuses.map((status) => (
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
          disabled={
            search === "" &&
            branchFilter === "" &&
            statusFilter === ""
          }
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
            : "No bookings match these filters. Try another search or clear the filters."}
        </p>
      ) : (
        <div
          className="staff-booking-table-wrap"
          role="region"
          aria-label="Booking results"
          tabIndex={0}
        >
          <table className="staff-booking-table">
            <caption>
              {isPreview
                ? "Sample reservations for the staff screen"
                : "Reservations matching your filters"}
            </caption>

            <thead>
              <tr>
                <th scope="col">Reference</th>
                <th scope="col">Guest</th>
                <th scope="col">Branch</th>
                <th scope="col">Stay dates</th>
                <th scope="col">Status</th>
                <th scope="col">Details</th>
              </tr>
            </thead>

            <tbody>
              {matchingBookings.map((booking) => (
                <tr key={booking.reference}>
                  <th scope="row">{booking.reference}</th>

                  <td>{booking.guestName}</td>

                  <td>{booking.branch}</td>

                  <td>
                    <span className="staff-stay-date">
                      In:{" "}
                      <time dateTime={booking.checkin}>
                        {formatDate(booking.checkin)}
                      </time>
                    </span>

                    <span className="staff-stay-date">
                      Out:{" "}
                      <time dateTime={booking.checkout}>
                        {formatDate(booking.checkout)}
                      </time>
                    </span>
                  </td>

                  <td>
                    <span
                      className="booking-status"
                      data-status={booking.status}
                    >
                      {booking.status}
                    </span>
                  </td>

                  <td>
                    <details className="staff-room-details">
                      <summary>
                        View details
                        <span className="booking-sr-only">
                          {" "}for {booking.reference}
                        </span>
                      </summary>

                      <p>Guests: {booking.guests}</p>
                      <p>Rooms: {booking.rooms.length}</p>

                      <ul>
                        {booking.rooms.map((room) => (
                          <li key={room.number}>
                            Room {room.number} — {room.roomType}
                          </li>
                        ))}
                      </ul>
                    </details>
                    
                    {isPreview && booking.status === "Checked-In" && (
                    <Link
                        className="staff-service-link"
                        to={`/preview/staff/bookings/${booking.reference}/services`}
                    >
                        Service entry preview
                    </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}