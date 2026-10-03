import { useState } from "react";
import { Link } from "react-router";

export default function StaffBillDetails() {
  // සාම්පල් බිල් සහ ගෙවීම් විස්තර
  const [bill, setBill] = useState({
    bookingId: "SKN-8492",
    guestName: "Lakshan Gamage",
    roomType: "Standard (Room 101)",
    roomCharges: 12000,
    serviceCharges: 2500,
    totalAmount: 14500,
    paymentsReceived: 10000,
    paymentHistory: [
      { id: "PAY-01", date: "2026-10-06", method: "Card", amount: 10000 }
    ]
  });

  const outstandingBalance = bill.totalAmount - bill.paymentsReceived;

  return (
    <section>
      <p className="eyebrow">STAFF BILLING PORTAL</p>
      <h1>Booking Bill & Payment Details</h1>

      <div style={{ background: "#fdfbf7", padding: "2rem", borderRadius: "8px", border: "1px solid #e2d9cc", marginTop: "1.5rem" }}>
        <h2>Reservation ID: {bill.bookingId}</h2>
        <p><strong>Guest Name:</strong> {bill.guestName}</p>
        <p><strong>Room:</strong> {bill.roomType}</p>

        <hr style={{ margin: "1.5rem 0", borderColor: "#e2d9cc" }} />

        <h3>Cost Breakdown</h3>
        <p>Room Charges: LKR {bill.roomCharges.toLocaleString()}.00</p>
        <p>Service Charges (Extra): LKR {bill.serviceCharges.toLocaleString()}.00</p>
        <p><strong>Total Bill Amount: LKR {bill.totalAmount.toLocaleString()}.00</strong></p>

        <hr style={{ margin: "1.5rem 0", borderColor: "#e2d9cc" }} />

        <h3>Payment Status</h3>
        <p>Total Paid: <span style={{ color: "green", fontWeight: "bold" }}>LKR {bill.paymentsReceived.toLocaleString()}.00</span></p>
        <p>Outstanding Balance: <span style={{ color: outstandingBalance > 0 ? "red" : "green", fontWeight: "bold" }}>LKR {outstandingBalance.toLocaleString()}.00</span></p>

        <h4 style={{ marginTop: "1.5rem" }}>Payment History</h4>
        {bill.paymentHistory.length > 0 ? (
          <ul style={{ paddingLeft: "20px", marginBottom: "1.5rem" }}>
            {bill.paymentHistory.map((pay) => (
              <li key={pay.id}>
                {pay.date} - LKR {pay.amount.toLocaleString()}.00 via {pay.method} ({pay.id})
              </li>
            ))}
          </ul>
        ) : (
          <p>No payments recorded yet.</p>
        )}

        <div style={{ display: "flex", gap: "1rem", marginTop: "2rem" }}>
          <Link className="button" to="/staff/record-payment">
            Record a Payment
          </Link>
          <Link className="button" style={{ background: "#6c757d" }} to="/staff/manager-reports">
            Back to Reports
          </Link>
        </div>
      </div>
    </section>
  );
}