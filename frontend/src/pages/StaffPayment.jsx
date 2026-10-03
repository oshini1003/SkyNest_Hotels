import { useState } from "react";
import { Link } from "react-router";
import { demoBill as bill, formatLkr } from "../data/demoBilling";

const paymentMethods = ["Cash", "Card", "Bank Transfer"];

export default function StaffPayment() {
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [simulation, setSimulation] = useState(null);
  const [error, setError] = useState("");
  const balanceCents = Math.round((bill.totalAmount - bill.paymentsReceived) * 100);

  function clearResult() {
    setSimulation(null);
    setError("");
  }

  function handleSimulatePayment(event) {
    event.preventDefault();
    clearResult();
    const amount = Number(paymentAmount);

    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a payment amount greater than zero.");
      return;
    }
    if (!/^\d+(?:\.\d{1,2})?$/.test(paymentAmount)) {
      setError("Enter an amount with no more than two decimal places.");
      return;
    }

    const amountCents = Math.round(amount * 100);
    if (amountCents > balanceCents) {
      setError("The payment cannot exceed the sample outstanding balance.");
      return;
    }
    if (!paymentMethods.includes(paymentMethod)) {
      setError("Choose a payment method from the list.");
      return;
    }

    setSimulation({
      amount: amountCents / 100,
      method: paymentMethod,
      remaining: (balanceCents - amountCents) / 100,
    });
  }

  return (
    <section>
      <p className="eyebrow">STAFF PAYMENT PREVIEW</p>
      <h1>Simulate a payment</h1>
      <p className="booking-notice">
        Development preview using fictional data. No money is collected and no
        payment is saved. Each simulation starts from the same sample balance.
      </p>

      <div className="card" style={{ marginTop: "1.5rem" }}>
        <h2>Sample reservation: {bill.bookingId}</h2>
        <p><strong>Guest:</strong> {bill.guestName}</p>
        <p>Sample total: {formatLkr(bill.totalAmount)}</p>
        <p>Sample amount paid: {formatLkr(bill.paymentsReceived)}</p>
        <p><strong>Sample outstanding balance: {formatLkr(balanceCents / 100)}</strong></p>

        <form onSubmit={handleSimulatePayment} className="auth-form" style={{ maxWidth: "400px" }}>
          <div className="form-field">
            <label htmlFor="preview-payment-amount">Payment amount (LKR)</label>
            <input
              id="preview-payment-amount"
              name="amount"
              type="number"
              min="0.01"
              max={balanceCents / 100}
              step="0.01"
              required
              value={paymentAmount}
              onChange={(event) => {
                setPaymentAmount(event.target.value);
                clearResult();
              }}
            />
          </div>
          <div className="form-field">
            <label htmlFor="preview-payment-method">Payment method</label>
            <select
              id="preview-payment-method"
              name="paymentMethod"
              value={paymentMethod}
              onChange={(event) => {
                setPaymentMethod(event.target.value);
                clearResult();
              }}
              style={{ padding: "12px", borderRadius: "6px", font: "inherit" }}
            >
              {paymentMethods.map((method) => (
                <option key={method} value={method}>{method}</option>
              ))}
            </select>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button" type="submit">Simulate payment</button>
          <div aria-live="polite">
            {simulation && (
              <p className="booking-notice">
                Simulation only: {formatLkr(simulation.amount)} via {simulation.method}
                {" "}would leave {formatLkr(simulation.remaining)} outstanding.
                {" "}<strong>No payment was recorded.</strong>
              </p>
            )}
          </div>
        </form>

        <Link className="button" to="/preview/staff/bill-details" style={{ marginTop: "2rem" }}>
          Back to sample bill
        </Link>
      </div>
    </section>
  );
}
