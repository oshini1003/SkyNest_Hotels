import { Link } from "react-router";
import { demoBill as bill, formatLkr } from "../data/demoBilling";

export default function StaffBillDetails() {
  const outstandingBalance = bill.totalAmount - bill.paymentsReceived;

  return (
    <section>
      <p className="eyebrow">STAFF BILLING PREVIEW</p>
      <h1>Sample bill details</h1>
      <p className="booking-notice">
        Development preview using fictional data. This page is not connected to
        the database. Payment simulations do not change this sample bill.
      </p>

      <div className="card" style={{ marginTop: "1.5rem" }}>
        <h2>Sample reservation: {bill.bookingId}</h2>
        <p><strong>Guest:</strong> {bill.guestName}</p>
        <p><strong>Room:</strong> {bill.roomType}</p>

        <h3>Cost breakdown</h3>
        <p>Room charges: {formatLkr(bill.roomCharges)}</p>
        <p>Service charges: {formatLkr(bill.serviceCharges)}</p>
        <p><strong>Total: {formatLkr(bill.totalAmount)}</strong></p>

        <h3>Sample payment status</h3>
        <p>Paid: {formatLkr(bill.paymentsReceived)}</p>
        <p><strong>Outstanding: {formatLkr(outstandingBalance)}</strong></p>

        <h3>Sample payment history</h3>
        <ul>
          {bill.paymentHistory.map((payment) => (
            <li key={payment.id}>
              {payment.date} — {formatLkr(payment.amount)} via {payment.method}
              {" "}({payment.id})
            </li>
          ))}
        </ul>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", marginTop: "2rem" }}>
          <Link className="button" to="/preview/staff/record-payment">
            Simulate a payment
          </Link>
          <Link className="button" to="/preview/staff/manager-reports">
            View sample reports
          </Link>
        </div>
      </div>
    </section>
  );
}
