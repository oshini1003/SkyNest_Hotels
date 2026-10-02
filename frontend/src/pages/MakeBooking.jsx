import { useState } from "react";


const initialGuestData = {
  name: "",
  contactNumber: "",
  email: "",
  idNumber: "",
  address: "",
  paymentMethod: "Card"
};

export default function MakeBooking() {
  const [formData, setFormData] = useState(initialGuestData);
  const [bookingStatus, setBookingStatus] = useState("");

  function handleChange(event) {
    const { name, value } = event.target;
    setFormData((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    // ඉස්සරහට Backend API එකට ඩේටා යවන්නේ මේ තැනින්
    console.log("Booking Data Submitted: ", formData);
    setBookingStatus("Booking successfully placed! (This is a preview)");
  }

  return (
    <section aria-labelledby="make-booking-heading">
      <p className="eyebrow">GUEST DETAILS</p>
      <h2 id="make-booking-heading">Complete Your Booking</h2>
      <p>Please enter your details to finalize the reservation.</p>

      <form className="room-search-form" onSubmit={handleSubmit}>
        
        {/* Name Field */}
        <div className="form-field">
          <label htmlFor="guest-name">Full Name</label>
          <input
            id="guest-name"
            name="name"
            type="text"
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
            value={formData.contactNumber}
            onChange={handleChange}
            required
          />
        </div>

        {/* Email Field */}
        <div className="form-field">
          <label htmlFor="guest-email">Email Address</label>
          <input
            id="guest-email"
            name="email"
            type="email"
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
            value={formData.idNumber}
            onChange={handleChange}
            required
          />
        </div>

        {/* Address Field */}
        <div className="form-field">
          <label htmlFor="guest-address">Address</label>
          <textarea
            id="guest-address"
            name="address"
            value={formData.address}
            onChange={handleChange}
            style={{ width: "100%", padding: "8px", borderRadius: "4px", border: "1px solid #ccc" }}
            required
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

        <button className="button" type="submit" style={{ marginTop: "1rem" }}>
          Confirm Booking
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