import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { formatStayDate, isCurrentStaff, loadStaffBooking, staffBookingId } from "../services/staffBookingApi";
import { canManageBilling, checkOutStaffBooking, loadStaffBill, moneyCents, paymentAmount, paymentMethods, recordStaffPayment } from "../services/billingApi";
import { clearBillingAttempt, readBillingAttempt, saveBillingAttempt } from "../services/billingAttempt";
import "./StaffBilling.css";

const money = new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR", currencyDisplay: "code" });
const initialForm = { amount: "", paymentMethod: "" };
const initialResult = { loading: true, error: "", booking: null, bill: null };

async function loadBillingContext(bookingId, token, signal) {
  const responses = await Promise.allSettled([
    loadStaffBooking(bookingId, token, signal),
    loadStaffBill(bookingId, token, signal),
  ]);
  const rejected = responses.find((response) => response.status === "rejected");
  if (rejected) throw rejected.reason;
  return { loading: false, error: "", booking: responses[0].value, bill: responses[1].value };
}

export default function StaffBilling({ session }) {
  const { id } = useParams();
  const bookingId = staffBookingId(id);
  if (bookingId === null) return <section><h1>Invalid booking reference</h1><p>Choose a reservation from the booking list.</p><Link to="/staff/bookings">Back to bookings</Link></section>;
  return <BookingBilling key={`${session.token}:${bookingId}`} bookingId={bookingId} session={session} />;
}

function BookingBilling({ bookingId, session }) {
  const token = session.token;
  const staffId = session.staff.staffId;
  const [savedAttempt] = useState(() => {
    try { return { entry: readBillingAttempt(staffId, bookingId), error: "" }; }
    catch (error) { return { entry: { kind: "unknown", payment: null }, error: error.message }; }
  });
  const [result, setResult] = useState(initialResult);
  const [fresh, setFresh] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [review, setReview] = useState(null);
  const [checkoutReview, setCheckoutReview] = useState(false);
  const [pending, setPending] = useState("");
  const [actionError, setActionError] = useState(savedAttempt.error);
  const [notice, setNotice] = useState("");
  const [reconciliation, setReconciliation] = useState(savedAttempt.entry);
  const busy = useRef(false);
  const action = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    loadBillingContext(bookingId, token, controller.signal).then((snapshot) => {
      if (controller.signal.aborted || !isCurrentStaff(token)) return;
      setResult(snapshot);
      setFresh(true);
    }).catch((error) => {
      if (controller.signal.aborted || !isCurrentStaff(token)) return;
      setResult({ ...initialResult, loading: false, error: error.message });
    });
    return () => controller.abort();
  }, [bookingId, token]);
  useEffect(() => () => action.current?.abort(), []);

  const { booking, bill } = result;
  const permitted = canManageBilling(session.staff.role);
  // Status and monetary eligibility come from the same bill snapshot. The
  // separate booking read supplies guest and room context only.
  const checkedIn = bill?.bookingStatus === "Checked-In";
  const balanceCents = bill ? moneyCents(bill.outstandingBalance, true) : null;
  const paymentEligible = permitted && checkedIn && Boolean(bill?.bill) && balanceCents > 0;
  const checkoutEligible = permitted && checkedIn && Boolean(bill?.bill) && balanceCents === 0;
  const blocked = Boolean(pending) || !fresh || result.loading || Boolean(result.error) || Boolean(reconciliation);

  function isActive(controller) {
    return !controller.signal.aborted && isCurrentStaff(token);
  }

  async function refreshSnapshot(controller) {
    setFresh(false);
    setResult((current) => ({ ...current, loading: true, error: "" }));
    try {
      const snapshot = await loadBillingContext(bookingId, token, controller.signal);
      if (!isActive(controller)) return;
      setResult(snapshot);
      setFresh(true);
    } catch (error) {
      if (!isActive(controller)) return;
      setResult((current) => ({ ...current, loading: false, error: error.message }));
    }
  }

  async function refresh() {
    if (busy.current || !isCurrentStaff(token)) return;
    busy.current = true;
    setReview(null);
    setCheckoutReview(false);
    const controller = new AbortController();
    action.current = controller;
    try {
      await refreshSnapshot(controller);
    } finally {
      busy.current = false;
    }
  }

  function changeForm(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
    setReview(null);
    setCheckoutReview(false);
    setActionError("");
    setNotice("");
  }

  function reviewPayment(event) {
    event.preventDefault();
    if (busy.current || blocked || !paymentEligible || !isCurrentStaff(token)) return;
    setReview(null);
    setCheckoutReview(false);
    setActionError("");
    setNotice("");
    const parsed = paymentAmount(form.amount);
    if (!parsed) {
      setActionError("Enter an amount from 0.01 to 99999999.99 with at most two decimal places. Use a decimal point without commas.");
      return;
    }
    if (parsed.cents > balanceCents) {
      setActionError("The payment cannot exceed the current outstanding balance. Refresh the bill if it has changed.");
      return;
    }
    if (!paymentMethods.includes(form.paymentMethod)) {
      setActionError("Choose Cash, Card or Bank Transfer.");
      return;
    }
    setReview({ ...parsed, paymentMethod: form.paymentMethod });
  }

  async function confirmAction(kind) {
    if (busy.current || blocked || !isCurrentStaff(token)) return;
    if (kind === "payment" && (!paymentEligible || !review || review.cents > balanceCents)) return;
    if (kind === "checkout" && (!checkoutEligible || !checkoutReview)) return;
    busy.current = true;
    const attemptedAction = { kind, payment: kind === "payment" ? review : null };
    try {
      // Persist before sending: an aborted page request may still commit on
      // the server, so navigation or reload must not lose this safety gate.
      saveBillingAttempt(staffId, bookingId, attemptedAction);
    } catch (error) {
      busy.current = false;
      setActionError(error.message);
      return;
    }
    setPending(kind);
    setFresh(false);
    setActionError("");
    setNotice("");
    const controller = new AbortController();
    action.current = controller;
    try {
      try {
        if (kind === "payment") {
          await recordStaffPayment({ bookingId, amount: review.amount, paymentMethod: review.paymentMethod }, token, controller.signal);
          if (!isActive(controller)) return;
          setNotice(`Payment of ${money.format(review.cents / 100)} by ${review.paymentMethod} was recorded for booking #${bookingId}.`);
          setForm(initialForm);
        } else {
          await checkOutStaffBooking(bookingId, token, controller.signal);
          if (!isActive(controller)) return;
          setNotice(`Booking #${bookingId} was checked out. Review the updated room statuses below.`);
        }
        try {
          clearBillingAttempt(staffId, bookingId);
        } catch (error) {
          setActionError(error.message);
          setReconciliation({ ...attemptedAction, confirmed: true });
        }
      } catch (error) {
        if (isActive(controller) && error.status >= 400 && error.status < 500 && !error.outcomeUnknown) {
          try { clearBillingAttempt(staffId, bookingId); }
          catch { /* Preserve the marker if browser storage is unavailable. */ }
        }
        if (!isActive(controller) || error.name === "AbortError") return;
        setActionError(error.message);
        if (error.outcomeUnknown) setReconciliation(attemptedAction);
      }
      if (!isActive(controller)) return;
      setReview(null);
      setCheckoutReview(false);
      // Refresh even after a conflict or an ambiguous acknowledgement. Keep
      // both mutation controls locked until both server reads have completed.
      await refreshSnapshot(controller);
    } finally {
      busy.current = false;
      if (isActive(controller)) setPending("");
    }
  }

  function finishReconciliation() {
    if (busy.current || !fresh || result.loading || result.error || !isCurrentStaff(token)) return;
    try { clearBillingAttempt(staffId, bookingId); }
    catch (error) { setActionError(error.message); return; }
    setReconciliation(null);
    setForm(initialForm);
    setReview(null);
    setCheckoutReview(false);
    setActionError("");
    setNotice("Reconciliation acknowledged. Review the current bill before recording any further payment.");
  }

  return (
    <section className="staff-billing-page" aria-labelledby="staff-billing-heading">
      <p className="eyebrow">STAFF WORKSPACE</p>
      <h1 id="staff-billing-heading">Bill and payments · Booking #{bookingId}</h1>
      <p><Link to={`/staff/bookings/${bookingId}`}>Back to booking</Link> · <Link to={`/staff/bookings/${bookingId}/services`}>Services</Link> · <Link to="/staff/bookings">All bookings</Link></p>
      {notice && <p className="form-success" role="status">{notice}</p>}
      {actionError && <p className="form-error" role="alert">{actionError}</p>}
      {reconciliation && <section className="booking-notice" aria-labelledby="billing-reconciliation-heading" role="alert">
        <h2 id="billing-reconciliation-heading">{reconciliation.confirmed ? "Reconcile the saved billing action" : `Reconcile the unconfirmed ${reconciliation.kind === "payment" ? "payment" : reconciliation.kind === "checkout" ? "check-out" : "billing action"}`}</h2>
        {reconciliation.payment && <p>Attempted payment: <strong>{money.format(reconciliation.payment.cents / 100)} · {reconciliation.payment.paymentMethod}</strong> for booking #{bookingId}.</p>}
        <p>{reconciliation.confirmed ? "The action was confirmed, but its saved browser check could not be cleared." : "This action may already have completed."} Review the refreshed payment IDs, amounts, timestamps, bill and booking status against your receipt and hotel records. A delayed request may still complete; an absent entry alone does not confirm failure.</p>
        <p>Do not enter the same payment again if it is already recorded. If the result remains uncertain, ask a manager to reconcile it before continuing.</p>
        <button className="button" type="button" disabled={Boolean(pending) || !fresh || result.loading || Boolean(result.error)} onClick={finishReconciliation}>I have reconciled this action with hotel records</button>
      </section>}
      {result.loading && <p role="status">{pending ? "Updating the bill, payment history and room status…" : "Loading the bill, payment history and booking…"}</p>}
      {result.error && <div className="booking-notice"><p className="form-error" role="alert">{result.error}</p><p>Payments and check-out are unavailable until the latest bill, history and booking can be read. Any recorded payment or completed check-out remains recorded.</p></div>}
      <p><button className="button" type="button" disabled={Boolean(pending) || result.loading} onClick={refresh}>Refresh bill, history and booking</button></p>
      {booking && bill && <>
        {!fresh && <p className="booking-notice">The details below are the last loaded view. Wait for a successful refresh before another action.</p>}
        <div className="card booking-card">
          <div className="booking-card-header"><h2>{booking.GuestName}</h2><span className="booking-status" data-status={bill.bookingStatus}>{bill.bookingStatus}</span></div>
          <h3>Reserved rooms</h3>
          {!booking.rooms.length ? <p>No rooms are assigned to this booking.</p> : <ul>{booking.rooms.map((room) => <li key={room.RoomID}>{room.BranchName} · Room {room.RoomNumber} · {room.RoomTypeName} · {formatStayDate(room.CheckInDate)} to {formatStayDate(room.CheckOutDate)} · Room status: <strong>{room.RoomStatus}</strong></li>)}</ul>}
        </div>

        <section className="stay-review" aria-labelledby="billing-summary-heading">
          <h2 id="billing-summary-heading">{bill.bill ? `Bill #${bill.bill.BillID}` : "Estimated booking charges"}</h2>
          {!bill.bill && <p>No bill has been opened. Check-in opens the bill before payments can be recorded.</p>}
          <dl className="stay-details">
            <div><dt>Room charges</dt><dd>{money.format(Number(bill.roomCharges))}</dd></div>
            <div><dt>Service charges</dt><dd>{money.format(Number(bill.serviceCharges))}</dd></div>
            <div><dt>Total amount</dt><dd>{money.format(Number(bill.totalAmount))}</dd></div>
            <div><dt>Paid amount</dt><dd>{money.format(Number(bill.paidAmount))}</dd></div>
            <div><dt>Outstanding balance</dt><dd>{money.format(Number(bill.outstandingBalance))}</dd></div>
            {bill.bill && <div><dt>Bill status</dt><dd>{bill.bill.BillStatus}</dd></div>}
          </dl>
        </section>

        <section className="billing-section" aria-labelledby="billing-services-heading">
          <h2 id="billing-services-heading">Service charges</h2>
          {!bill.serviceUsage.length ? <p>No service charges have been recorded.</p> : <div className="staff-booking-table-wrap" role="region" aria-label="Itemised service charges" tabIndex="0">
            <table className="staff-booking-table"><caption>Services recorded for booking #{bookingId}</caption><thead><tr><th scope="col">Entry</th><th scope="col">Recorded at</th><th scope="col">Service</th><th scope="col">Quantity</th><th scope="col">Saved unit price</th><th scope="col">Line total</th></tr></thead>
              <tbody>{bill.serviceUsage.map((usage) => <tr key={usage.UsageID}><td>#{usage.UsageID}</td><td>{usage.UsageDateDisplay}</td><th scope="row">{usage.ServiceName}</th><td>{usage.Quantity}</td><td>{money.format(Number(usage.PriceAtUsage))}</td><td>{money.format(Number(usage.LineTotal))}</td></tr>)}</tbody>
            </table>
          </div>}
        </section>

        <section className="billing-section" aria-labelledby="payment-history-heading">
          <h2 id="payment-history-heading">Payment history</h2>
          <p>Times are shown as recorded by the hotel. A preferred payment method does not confirm a payment.</p>
          {!bill.payments.length ? <p>No payments have been recorded for this booking.</p> : <div className="staff-booking-table-wrap" role="region" aria-label="Payment history" tabIndex="0">
            <table className="staff-booking-table"><caption>Recorded payments for booking #{bookingId}</caption><thead><tr><th scope="col">Payment ID</th><th scope="col">Bill ID</th><th scope="col">Recorded at</th><th scope="col">Type</th><th scope="col">Method</th><th scope="col">Amount</th></tr></thead>
              <tbody>{bill.payments.map((payment) => <tr key={payment.PaymentID}><th scope="row">#{payment.PaymentID}</th><td>#{payment.BillID}</td><td>{payment.PaymentDateDisplay}</td><td>{payment.PaymentType}</td><td>{payment.PaymentMethod}</td><td>{money.format(Number(payment.Amount))}</td></tr>)}</tbody>
            </table>
          </div>}
        </section>

        {!permitted ? <p className="booking-notice">Your ServiceStaff account can view the bill and payment history. Ask reception, a manager or an administrator to record a payment or check out this booking.</p> : <>
          <section className="billing-section" aria-labelledby="record-payment-heading">
            <h2 id="record-payment-heading">Record a received payment</h2>
            <p>This records money already received by the hotel. It does not charge a card or initiate a bank transfer.</p>
            {!checkedIn ? <p>Payments can only be recorded while this booking is Checked-In.</p>
              : !bill.bill ? <p>An open bill is required before recording a payment.</p>
                : balanceCents === 0 ? <p>The bill is fully paid. No further payment is needed.</p>
                  : balanceCents < 0 ? <p>The bill has a credit balance. Ask a manager to reconcile it before proceeding.</p>
                    : <>
                      <form className="billing-payment-form" noValidate onSubmit={reviewPayment}>
                        <div className="form-field"><label htmlFor="billing-payment-amount">Amount received (LKR)</label><input id="billing-payment-amount" name="amount" type="text" inputMode="decimal" autoComplete="off" value={form.amount} disabled={blocked} onChange={changeForm} aria-describedby="billing-amount-help" /></div>
                        <div className="form-field"><label htmlFor="billing-payment-method">Payment method</label><select id="billing-payment-method" name="paymentMethod" value={form.paymentMethod} disabled={blocked} onChange={changeForm}><option value="">Choose a payment method</option>{paymentMethods.map((method) => <option key={method} value={method}>{method}</option>)}</select></div>
                        <p id="billing-amount-help">Enter up to two decimal places, for example 1250.50. Maximum for this bill: {money.format(Math.min(balanceCents, 9999999999) / 100)}. Partial payments are allowed.</p>
                        <div className="billing-actions"><button className="button" type="submit" disabled={blocked}>Review payment</button></div>
                      </form>
                      {review && <section className="billing-action-review" aria-labelledby="payment-review-heading">
                        <h3 id="payment-review-heading">Review received payment</h3>
                        <dl className="stay-details"><div><dt>Booking</dt><dd>#{bookingId} · {booking.GuestName}</dd></div><div><dt>Amount received</dt><dd>{money.format(review.cents / 100)}</dd></div><div><dt>Method</dt><dd>{review.paymentMethod}</dd></div><div><dt>Expected remaining balance</dt><dd>{money.format((balanceCents - review.cents) / 100)}</dd></div></dl>
                        <p id="payment-confirmation">Confirm the hotel has already received this money and it has not already been recorded. Saving adds a payment record to this bill.</p>
                        <p>The server checks the latest balance when saving. Refresh and review again if another staff member changes this booking.</p>
                        <div className="billing-actions"><button className="button" type="button" disabled={blocked} aria-describedby="payment-confirmation" onClick={() => confirmAction("payment")}>{pending === "payment" ? "Recording payment…" : "Confirm and record payment"}</button><button className="button billing-secondary" type="button" disabled={blocked} onClick={() => setReview(null)}>Edit payment</button></div>
                      </section>}
                    </>}
          </section>

          {checkedIn && <section className="billing-section stay-review" aria-labelledby="checkout-heading">
            <h2 id="checkout-heading">Guest check-out</h2>
            {!bill.bill ? <p>An open bill is required before check-out.</p>
              : balanceCents > 0 ? <p>Record the remaining {money.format(balanceCents / 100)} before check-out. The outstanding balance must be exactly zero.</p>
                : balanceCents < 0 ? <p>Check-out is blocked while the bill has a credit balance. Ask a manager to reconcile it.</p>
                  : checkoutReview ? <>
                    <p id="checkout-confirmation">Confirm check-out for {booking.GuestName}, booking #{bookingId}? The balance is zero. This marks the booking Checked-Out and updates room availability.</p>
                    <p>{booking.rooms.map((room) => `${room.BranchName}, room ${room.RoomNumber}`).join("; ")}</p>
                    <div className="billing-actions"><button className="button" type="button" disabled={blocked} aria-describedby="checkout-confirmation" onClick={() => confirmAction("checkout")}>{pending === "checkout" ? "Checking out…" : "Confirm check-out"}</button><button className="button billing-secondary" type="button" disabled={blocked} onClick={() => setCheckoutReview(false)}>Not yet</button></div>
                  </> : <><p>The current bill is fully paid. Check-out updates the booking and its room availability.</p><button className="button" type="button" disabled={blocked} onClick={() => { if (busy.current) return; setCheckoutReview(true); setReview(null); setActionError(""); }}>Check out guest</button></>}
          </section>}
        </>}
      </>}
    </section>
  );
}
