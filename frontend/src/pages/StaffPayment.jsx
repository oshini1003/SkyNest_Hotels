import { useState } from "react";
import { Link } from "react-router";

export default function StaffPayment() {
  const [bill, setBill] = useState({
    bookingId: "SKN-8492",
    guestName: "Lakshan Gamage",
    totalAmount: 14500,
    paymentsReceived: 10000
  });

  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [successMessage, setSuccessMessage] = useState("");

  const outstandingBalance = bill.totalAmount - bill.paymentsReceived;

  function handleRecordPayment(e) {
    e.preventDefault();
    const amountNum = parseFloat(paymentAmount);

    if (!amountNum || amountNum <= 0) {
      alert("Please enter a valid payment amount.");
      return;
    }

    if (amountNum > outstandingBalance) {
      alert("Payment amount cannot exceed the outstanding balance.");
      return;
    }

   
    const updatedPaid = bill.paymentsReceived + amountNum;
    setBill({
      ...bill,
      paymentsReceived: updatedPaid
    });

    setSuccessMessage(`Successfully recorded LKR ${amountNum.toLocaleString()}.00 via ${paymentMethod}!`);
    setPaymentAmount("");
  }

  const currentBalance = bill.totalAmount - bill.paymentsReceived;

  return (
    <section>
      <p className="eyebrow">STAFF BILLING PORTAL</p>
      <h1>Record a Payment</h1>

      <div style={{ background: "#fdfbf7", padding: "2rem", borderRadius: "8px", border: "1px solid #e2d9cc", marginTop: "1.5rem" }}>
        <h2>Reservation ID: {bill.bookingId}</h2>
        <p><strong>Guest Name:</strong> {bill.guestName}</p>
        <p>Total Bill Amount: LKR {bill.totalAmount.toLocaleString()}.00</p>
        <p>Total Paid So Far: <span style={{ color: "green", fontWeight: "bold" }}>LKR {bill.paymentsReceived.toLocaleString()}.00</span></p>
        <p>Current Outstanding Balance: <span style={{ color: currentBalance > 0 ? "red" : "green", fontWeight: "bold" }}>LKR {currentBalance.toLocaleString()}.00</span></p>

        <hr style={{ margin: "1.5rem 0", borderColor: "#e2d9cc" }} />

        {successMessage && (
          <div style={{ background: "#d4edda", color: "#155724", padding: "10px", borderRadius: "4px", marginBottom: "1.5rem", border: "1px solid #c3e6cb" }}>
            {successMessage}
          </div>
        )}

        {currentBalance > 0 ? (
          <form onSubmit={handleRecordPayment} style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: "400px" }}>
            <div>
              <label style={{ display: "block", marginBottom: "5px", fontWeight: "bold" }}>Payment Amount (LKR):</label>
              <input
                type="number"
                placeholder="Enter amount"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                style={{ padding: "8px", width: "100%", borderRadius: "4px", border: "1px solid #ccc" }}
              />
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "5px", fontWeight: "bold" }}>Payment Method:</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                style={{ padding: "8px", width: "100%", borderRadius: "4px", border: "1px solid #ccc" }}
              >
                <option value="Cash">Cash</option>
                <option value="Card">Card</option>
                <option value="Bank Transfer">Bank Transfer</option>
              </select>
            </div>

            <button className="button" type="submit" style={{ marginTop: "10px" }}>
              Confirm & Record Payment
            </button>
          </form>
        ) : (
          <p style={{ color: "green", fontWeight: "bold" }}>This bill is fully settled! No outstanding balance.</p>
        )}

        <div style={{ marginTop: "2rem", display: "flex", gap: "1rem" }}>
          <Link className="button" style={{ background: "#6c757d" }} to="/staff/bill-details">
            Back to Bill Details
          </Link>
        </div>
      </div>
    </section>
  );
}