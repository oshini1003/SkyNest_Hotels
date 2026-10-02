import { useState } from "react";
import { Link, useParams } from "react-router";
import { demoStaffBookings } from "../data/demoStaffBookings";
import { demoServices } from "../data/demoServices";

const initialForm = {
  roomNumber: "",
  serviceId: "",
  quantity: "1",
};

const money = new Intl.NumberFormat("en-LK", {
  style: "currency",
  currency: "LKR",
  currencyDisplay: "code",
});

function ServiceUsageForm({ booking, services }) {
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState("");
  const [review, setReview] = useState(null);

  const selectedService = services.find(
    (service) => service.id === form.serviceId
  );

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value,
    }));

    setError("");
    setReview(null);
  }

  function clearForm() {
    setForm(initialForm);
    setError("");
    setReview(null);
  }

  function handleReview(event) {
    event.preventDefault();
    setError("");
    setReview(null);

    if (booking.status !== "Checked-In") {
      setError(
        "Service entry is available only for checked-in bookings."
      );
      return;
    }

    const room = booking.rooms.find(
      (item) => item.number === form.roomNumber
    );

    if (!room) {
      setError("Please choose a room from this booking.");
      return;
    }

    const service = services.find(
      (item) => item.id === form.serviceId
    );

    if (!service) {
      setError("Please choose a service.");
      return;
    }

    const quantity = Number(form.quantity);

    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      setError("Quantity must be a whole number of at least 1.");
      return;
    }

    const unitPriceCents = Math.round(service.unitPrice * 100);
    const totalCents = unitPriceCents * quantity;

    if (!Number.isSafeInteger(totalCents)) {
      setError("That quantity is too large.");
      return;
    }

    setReview({
      roomNumber: room.number,
      roomType: room.roomType,
      serviceName: service.name,
      quantity,
      unit: service.unit,
      unitPrice: unitPriceCents / 100,
      total: totalCents / 100,
    });
  }

  return (
    <>
      <form
        className="service-entry-form"
        onSubmit={handleReview}
      >
        <div className="form-field">
          <label htmlFor="usage-room">
            Room
          </label>

          <select
            id="usage-room"
            name="roomNumber"
            value={form.roomNumber}
            onChange={handleChange}
            required
          >
            <option value="">Choose a room</option>

            {booking.rooms.map((room) => (
              <option key={room.number} value={room.number}>
                Room {room.number} — {room.roomType}
              </option>
            ))}
          </select>
        </div>

        <div className="form-field">
          <label htmlFor="usage-service">
            Service
          </label>

          <select
            id="usage-service"
            name="serviceId"
            value={form.serviceId}
            onChange={handleChange}
            required
          >
            <option value="">Choose a service</option>

            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </select>
        </div>

        <div className="form-field">
          <label htmlFor="usage-quantity">
            Quantity
          </label>

          <input
            id="usage-quantity"
            name="quantity"
            type="number"
            min="1"
            step="1"
            required
            value={form.quantity}
            onChange={handleChange}
          />
        </div>

        {selectedService && (
          <p className="service-entry-price">
            Sample unit price:{" "}
            <strong>
              {money.format(selectedService.unitPrice)}
            </strong>
            {" "}per {selectedService.unit}
          </p>
        )}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="service-entry-actions">
          <button className="button" type="submit">
            Review service entry
          </button>

          <button
            className="button service-entry-clear"
            type="button"
            onClick={clearForm}
          >
            Clear form
          </button>
        </div>
      </form>

      {review && (
        <section
          className="service-entry-review"
          aria-labelledby="service-review-heading"
        >
          <h2 id="service-review-heading">
            Review service entry
          </h2>

          <p role="status">
            Preview only. No service usage has been saved.
          </p>

          <dl>
            <div>
              <dt>Booking</dt>
              <dd>{booking.reference}</dd>
            </div>

            <div>
              <dt>Room</dt>
              <dd>
                {review.roomNumber} — {review.roomType}
              </dd>
            </div>

            <div>
              <dt>Service</dt>
              <dd>{review.serviceName}</dd>
            </div>

            <div>
              <dt>Quantity</dt>
              <dd>{review.quantity}</dd>
            </div>

            <div>
              <dt>Unit price</dt>
              <dd>
                {money.format(review.unitPrice)} per {review.unit}
              </dd>
            </div>

            <div>
              <dt>Estimated service charge</dt>
              <dd>{money.format(review.total)}</dd>
            </div>
          </dl>
        </section>
      )}
    </>
  );
}

export default function ServiceUsagePreview() {
  const { bookingReference } = useParams();

  const booking = demoStaffBookings.find(
    (item) => item.reference === bookingReference
  );

  if (!booking || booking.status !== "Checked-In") {
    return (
      <section>
        <h1>Service entry</h1>

        <p>
          {!booking
            ? "This sample booking was not found."
            : "Service entry is available only for checked-in bookings."}
        </p>

        <Link className="button" to="/preview/staff/bookings">
          Back to staff bookings
        </Link>
      </section>
    );
  }

  return (
    <section aria-labelledby="service-entry-heading">
      <p className="eyebrow">STAFF WORKSPACE</p>

      <h1 id="service-entry-heading">
        Service entry
      </h1>

      <p>
        <strong>{booking.reference}</strong>
        {" · "}
        {booking.guestName}
        {" · "}
        SkyNest {booking.branch}
      </p>

      <p className="booking-notice">
        Development preview: choose a room, service and quantity
        to review a sample charge. Nothing is saved or added to a bill.
      </p>

      <ServiceUsageForm
        key={booking.reference}
        booking={booking}
        services={demoServices}
      />

      <Link
        className="service-entry-back"
        to="/preview/staff/bookings"
      >
        Back to staff bookings
      </Link>
    </section>
  );
}