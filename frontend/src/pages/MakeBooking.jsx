import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { searchRooms, validateStay } from "../services/roomApi";

const money = new Intl.NumberFormat("en-LK", {
  style: "currency",
  currency: "LKR",
  currencyDisplay: "code",
});

function getPreviewSelection(selection) {
  if (
    !selection ||
    !Number.isSafeInteger(selection.roomId) || selection.roomId < 1 ||
    !Number.isSafeInteger(selection.guests) || selection.guests < 1
  ) return null;
  try {
    return { ...validateStay(selection), roomId: selection.roomId };
  } catch {
    return null;
  }
}

const initialGuestData = {
  name: "",
  contactNumber: "",
  email: "",
  idNumber: "",
  address: "",
  paymentMethod: "Card"
};

export default function MakeBooking() {
  const { state } = useLocation();
  const selection = getPreviewSelection(state?.stay);

  if (!selection) {
    return (
      <section>
        <h1>Select a room first</h1>
        <p>Choose a room and valid stay dates to open the booking preview.</p>
        <Link className="button" to="/rooms">Find a room</Link>
      </section>
    );
  }

  return (
    <AvailableStayPreview
      key={`${selection.roomId}:${selection.checkin}:${selection.checkout}:${selection.guests}`}
      selection={selection}
    />
  );
}

function AvailableStayPreview({ selection }) {
  const { roomId, checkin, checkout, guests } = selection;
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState({ loading: true, error: "", room: null });

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    searchRooms({ roomId, checkin, checkout, guests }, controller.signal)
      .then((rooms) => {
        if (!active) return;
        const room = rooms.find((item) => item.id === roomId && item.capacity >= guests) || null;
        setStatus({ loading: false, error: "", room });
      })
      .catch((failure) => {
        if (active && failure.name !== "AbortError") {
          setStatus({ loading: false, error: failure.message, room: null });
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [roomId, checkin, checkout, guests, attempt]);

  function retryAvailability() {
    setStatus({ loading: true, error: "", room: null });
    setAttempt((current) => current + 1);
  }

  if (status.loading || status.error || !status.room) {
    return (
      <section aria-labelledby="booking-availability-heading">
        <h1 id="booking-availability-heading">Booking preview</h1>
        {status.loading ? (
          <p role="status">Checking your selected room and its current price…</p>
        ) : status.error ? (
          <p className="form-error" role="alert">{status.error}</p>
        ) : (
          <p role="status">This room is no longer available for the selected dates and guest count.</p>
        )}
        <p>No room has been reserved.</p>
        {!status.loading && (
          <p>
            <button className="button" type="button" onClick={retryAvailability}>
              Check availability again
            </button>
          </p>
        )}
        <Link className="button" to="/rooms">Find a room</Link>
      </section>
    );
  }

  return <BookingPreviewForm stay={{ ...selection, room: status.room }} />;
}

function BookingPreviewForm({ stay }) {
  const [formData, setFormData] = useState(initialGuestData);
  const [bookingStatus, setBookingStatus] = useState("");
  const [error, setError] = useState("");

  function handleChange(event) {
    const { name, value } = event.target;
    setBookingStatus("");
    setError("");

    if (name === "contactNumber" && !/^\+?[0-9 -]*$/.test(value)) {
      setError("Contact number can contain digits, spaces, hyphens, and an optional + at the start.");
      return;
    }

    setFormData((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    setBookingStatus("");
    setError("");

    try {
      validateStay(stay);
    } catch (failure) {
      setError(`${failure.message} Please choose another stay.`);
      return;
    }

    if (!formData.name.trim() || !formData.idNumber.trim()) {
      setError("Please complete all required fields.");
      return;
    }

    const contactNumber = formData.contactNumber.trim().replace(/[ -]/g, "");
    if (!/^\+?[0-9]{7,15}$/.test(contactNumber)) {
      setError("Enter a contact number with 7–15 digits, for example 0712345678 or +94712345678.");
      return;
    }

    setBookingStatus("Details checked for this preview. No booking has been created and no payment has been taken.");
  }

  return (
    <section aria-labelledby="make-booking-heading">
      <p className="eyebrow">GUEST DETAILS PREVIEW</p>
      <h1 id="make-booking-heading">Booking preview</h1>
      <p className="room-demo-note">
        The room details and prices below come from the hotel database.
        This preview does not save your details, reserve a room, or take a payment.
        Availability can change. Use sample guest details while testing.
      </p>

      <h2>Your selected stay</h2>
      <dl className="stay-details">
        <div><dt>Branch</dt><dd>{stay.room.branch}</dd></div>
        <div><dt>Room</dt><dd>{stay.room.number} · {stay.room.roomType}</dd></div>
        <div><dt>Check-in</dt><dd>{stay.checkin}</dd></div>
        <div><dt>Check-out</dt><dd>{stay.checkout}</dd></div>
        <div><dt>Guests</dt><dd>{stay.guests}</dd></div>
        <div><dt>Nights</dt><dd>{stay.nights}</dd></div>
      </dl>
      <p className="room-price">
        Estimated room charge: {money.format(stay.room.pricePerNight * stay.nights)}
      </p>
      <p className="room-charge-note">Services and other charges are excluded.</p>
      <p><Link to="/rooms">Choose another stay</Link></p>

      <form className="room-search-form" onSubmit={handleSubmit}>
        
        {/* Name Field */}
        <div className="form-field">
          <label htmlFor="guest-name">Full Name</label>
          <input
            id="guest-name"
            name="name"
            type="text"
            autoComplete="name"
            maxLength={100}
            value={formData.name}
            onChange={handleChange}
            required
          />
        </div>

        {/* Contact Number Field */}
        <div className="form-field">
          <label htmlFor="guest-contact">Contact Number</label>
          <input
            id="guest-contact"
            name="contactNumber"
            type="tel"
            autoComplete="tel"
            maxLength={20}
            value={formData.contactNumber}
            onChange={handleChange}
            required
          />
        </div>

        {/* Email Field */}
        <div className="form-field">
          <label htmlFor="guest-email">Email Address (optional)</label>
          <input
            id="guest-email"
            name="email"
            type="email"
            autoComplete="email"
            maxLength={150}
            value={formData.email}
            onChange={handleChange}
          />
        </div>

        {/* ID / Passport Field (Required for Check-in verification) */}
        <div className="form-field">
          <label htmlFor="guest-id">NIC / Passport Number</label>
          <input
            id="guest-id"
            name="idNumber"
            type="text"
            maxLength={30}
            value={formData.idNumber}
            onChange={handleChange}
            required
          />
        </div>

        {/* Address Field */}
        <div className="form-field">
          <label htmlFor="guest-address">Address (optional)</label>
          <textarea
            id="guest-address"
            name="address"
            autoComplete="street-address"
            maxLength={255}
            value={formData.address}
            onChange={handleChange}
            style={{ width: "100%", padding: "8px", borderRadius: "4px", border: "1px solid #ccc" }}
          />
        </div>

        {/* Payment Method Field */}
        <div className="form-field">
          <label htmlFor="payment-method">Payment Method</label>
          <select
            id="payment-method"
            name="paymentMethod"
            value={formData.paymentMethod}
            onChange={handleChange}
          >
            <option value="Card">Credit/Debit Card</option>
            <option value="Cash">Cash at Check-in</option>
            <option value="Bank Transfer">Bank Transfer</option>
          </select>
        </div>

        {error && <p className="form-error" role="alert">{error}</p>}

        <button className="button" type="submit" style={{ marginTop: "1rem" }}>
          Check preview details
        </button>
      </form>

      {bookingStatus && (
        <p className="room-search-summary" role="status" style={{ marginTop: "20px", color: "green", fontWeight: "bold" }}>
          {bookingStatus}
        </p>
      )}
    </section>
  );
}
