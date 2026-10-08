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
  if (bookingId === null) return (
    <section className="staff-billing-page" aria-labelledby="invalid-billing-heading">
      <div className="sbill-state-panel">
        <p className="sbill-eyebrow">STAFF WORKSPACE · BILLING</p>
        <h1 id="invalid-billing-heading">Invalid booking reference</h1>
        <p>Choose a reservation from the booking list.</p>
        <Link className="sbill-button sbill-button-primary" to="/staff/bookings">Back to bookings</Link>
      </div>
    </section>
  );
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
      <nav className="sbill-navigation" aria-label="Billing navigation">
        <Link to={`/staff/bookings/${bookingId}`}><span aria-hidden="true">←</span> Back to booking</Link>
        <div><Link to={`/staff/bookings/${bookingId}/services`}>Services</Link><Link to="/staff/bookings">All bookings</Link></div>
      </nav>
      <header className="sbill-page-heading">
        <div>
          <p className="sbill-eyebrow">STAFF WORKSPACE · BILLING</p>
          <h1 id="staff-billing-heading">Bill &amp; payments</h1>
          <p className="sbill-introduction">Booking #{bookingId} · Review charges, record received payments and complete the stay.</p>
        </div>
        <button className="sbill-button sbill-button-secondary sbill-refresh" type="button" disabled={Boolean(pending) || result.loading} onClick={refresh}><span aria-hidden="true">↻</span> Refresh bill, history and booking</button>
      </header>
      {notice && <p className="sbill-message sbill-message-success" role="status">{notice}</p>}
      {actionError && <p className="sbill-message sbill-message-error" role="alert">{actionError}</p>}
      {reconciliation && <section className="sbill-reconciliation" aria-labelledby="billing-reconciliation-heading" role="alert">
        <p className="sbill-eyebrow">REVIEW REQUIRED</p>
        <h2 id="billing-reconciliation-heading">{reconciliation.confirmed ? "Reconcile the saved billing action" : `Reconcile the unconfirmed ${reconciliation.kind === "payment" ? "payment" : reconciliation.kind === "checkout" ? "check-out" : "billing action"}`}</h2>
        {reconciliation.payment && <p>Attempted payment: <strong>{money.format(reconciliation.payment.cents / 100)} · {reconciliation.payment.paymentMethod}</strong> for booking #{bookingId}.</p>}
        <p>{reconciliation.confirmed ? "The action was confirmed, but its saved browser check could not be cleared." : "This action may already have completed."} Review the refreshed payment IDs, amounts, timestamps, bill and booking status against your receipt and hotel records. A delayed request may still complete; an absent entry alone does not confirm failure.</p>
        <p>Do not enter the same payment again if it is already recorded. If the result remains uncertain, ask a manager to reconcile it before continuing.</p>
        <button className="sbill-button sbill-button-primary" type="button" disabled={Boolean(pending) || !fresh || result.loading || Boolean(result.error)} onClick={finishReconciliation}>I have reconciled this action with hotel records</button>
      </section>}
      {result.loading && <div className="sbill-message sbill-message-loading" role="status"><span className="sbill-loading-mark" aria-hidden="true" />{pending ? "Updating the bill, payment history and room status…" : "Loading the bill, payment history and booking…"}</div>}
      {result.error && <div className="sbill-message sbill-message-error"><p role="alert">{result.error}</p><p>Payments and check-out are unavailable until the latest bill, history and booking can be read. Any recorded payment or completed check-out remains recorded.</p></div>}
      {booking && bill && <>
        {!fresh && <p className="sbill-message sbill-message-warning">The details below are the last loaded view. Wait for a successful refresh before another action.</p>}
        <div className="sbill-overview">
          <section className="sbill-invoice" aria-labelledby="billing-summary-heading">
            <div className="sbill-invoice-heading">
              <div><p className="sbill-eyebrow">CHARGES &amp; BALANCE</p><h2 id="billing-summary-heading">{bill.bill ? `Bill #${bill.bill.BillID}` : "Estimated booking charges"}</h2></div>
              {bill.bill && <span className="sbill-status" data-status={bill.bill.BillStatus}>{bill.bill.BillStatus}</span>}
            </div>
            {!bill.bill && <p className="sbill-estimate-note">No bill has been opened. Check-in opens the bill before payments can be recorded.</p>}
            <dl className="sbill-invoice-lines">
              <div><dt>Room charges</dt><dd>{money.format(Number(bill.roomCharges))}</dd></div>
              <div><dt>Service charges</dt><dd>{money.format(Number(bill.serviceCharges))}</dd></div>
              <div className="sbill-invoice-total"><dt>Total amount</dt><dd>{money.format(Number(bill.totalAmount))}</dd></div>
              <div><dt>Paid amount</dt><dd>{money.format(Number(bill.paidAmount))}</dd></div>
              <div className="sbill-balance"><dt>Outstanding balance</dt><dd>{money.format(Number(bill.outstandingBalance))}</dd></div>
            </dl>
            <p className="sbill-invoice-footnote">Recorded service prices and payment amounts are shown in the history below.</p>
          </section>

          <section className="sbill-stay" aria-labelledby="billing-guest-heading">
            <div className="sbill-stay-heading"><p className="sbill-eyebrow">GUEST &amp; STAY</p><span className="sbill-status" data-status={bill.bookingStatus}>{bill.bookingStatus}</span></div>
            <h2 id="billing-guest-heading">{booking.GuestName}</h2>
            <h3 className="sbill-small-heading">Reserved rooms</h3>
            {!booking.rooms.length ? <p className="sbill-empty">No rooms are assigned to this booking.</p> : <ul className="sbill-room-list">{booking.rooms.map((room) => <li key={room.RoomID}>
              <p className="sbill-room-branch">{room.BranchName}</p>
              <p className="sbill-room-name">Room {room.RoomNumber} <span>· {room.RoomTypeName}</span></p>
              <p className="sbill-room-dates">{formatStayDate(room.CheckInDate)} to {formatStayDate(room.CheckOutDate)}</p>
              <p className="sbill-room-status">Room status: <strong>{room.RoomStatus}</strong></p>
            </li>)}</ul>}
          </section>
        </div>

        {!permitted ? <p className="sbill-message sbill-message-info">Your ServiceStaff account can view the bill and payment history. Ask reception, a manager or an administrator to record a payment or check out this booking.</p> : <div className="sbill-action-layout">
          <section className="sbill-action-panel" aria-labelledby="record-payment-heading">
            <div className="sbill-section-heading"><p className="sbill-eyebrow">RECEIVED PAYMENTS</p><h2 id="record-payment-heading">Record a received payment</h2></div>
            <p className="sbill-description">This records money already received by the hotel. It does not charge a card or initiate a bank transfer.</p>
            {!checkedIn ? <p className="sbill-action-state">Payments can only be recorded while this booking is Checked-In.</p>
              : !bill.bill ? <p className="sbill-action-state">An open bill is required before recording a payment.</p>
                : balanceCents === 0 ? <p className="sbill-action-state">The bill is fully paid. No further payment is needed.</p>
                  : balanceCents < 0 ? <p className="sbill-action-state">The bill has a credit balance. Ask a manager to reconcile it before proceeding.</p>
                    : <>
                      <form className="sbill-payment-form" noValidate onSubmit={reviewPayment}>
                        <div className="sbill-field"><label htmlFor="billing-payment-amount">Amount received (LKR)</label><input id="billing-payment-amount" name="amount" type="text" inputMode="decimal" autoComplete="off" value={form.amount} disabled={blocked} onChange={changeForm} aria-describedby="billing-amount-help" /></div>
                        <div className="sbill-field"><label htmlFor="billing-payment-method">Payment method</label><select id="billing-payment-method" name="paymentMethod" value={form.paymentMethod} disabled={blocked} onChange={changeForm}><option value="">Choose a payment method</option>{paymentMethods.map((method) => <option key={method} value={method}>{method}</option>)}</select></div>
                        <p className="sbill-field-help" id="billing-amount-help">Enter up to two decimal places, for example 1250.50. Maximum for this bill: {money.format(Math.min(balanceCents, 9999999999) / 100)}. Partial payments are allowed.</p>
                        <div className="sbill-actions"><button className="sbill-button sbill-button-primary" type="submit" disabled={blocked}>Review payment <span aria-hidden="true">→</span></button></div>
                      </form>
                      {review && <section className="sbill-action-review" aria-labelledby="payment-review-heading">
                        <p className="sbill-eyebrow">CONFIRM BEFORE SAVING</p>
                        <h3 id="payment-review-heading">Review received payment</h3>
                        <dl className="sbill-review-details"><div><dt>Booking</dt><dd>#{bookingId} · {booking.GuestName}</dd></div><div><dt>Amount received</dt><dd>{money.format(review.cents / 100)}</dd></div><div><dt>Method</dt><dd>{review.paymentMethod}</dd></div><div><dt>Expected remaining balance</dt><dd>{money.format((balanceCents - review.cents) / 100)}</dd></div></dl>
                        <p id="payment-confirmation">Confirm the hotel has already received this money and it has not already been recorded. Saving adds a payment record to this bill.</p>
                        <p>The server checks the latest balance when saving. Refresh and review again if another staff member changes this booking.</p>
                        <div className="sbill-actions"><button className="sbill-button sbill-button-primary" type="button" disabled={blocked} aria-describedby="payment-confirmation" onClick={() => confirmAction("payment")}>{pending === "payment" ? "Recording payment…" : "Confirm and record payment"}</button><button className="sbill-button sbill-button-secondary" type="button" disabled={blocked} onClick={() => setReview(null)}>Edit payment</button></div>
                      </section>}
                    </>}
          </section>

          {checkedIn && <section className="sbill-checkout-panel" aria-labelledby="checkout-heading">
            <div className="sbill-checkout-heading"><p className="sbill-eyebrow">COMPLETE THE STAY</p><h2 id="checkout-heading">Guest check-out</h2></div>
            <div className="sbill-checkout-body">
              {!bill.bill ? <p>An open bill is required before check-out.</p>
                : balanceCents > 0 ? <p>Record the remaining <strong>{money.format(balanceCents / 100)}</strong> before check-out. The outstanding balance must be exactly zero.</p>
                  : balanceCents < 0 ? <p>Check-out is blocked while the bill has a credit balance. Ask a manager to reconcile it.</p>
                    : checkoutReview ? <>
                      <p id="checkout-confirmation">Confirm check-out for {booking.GuestName}, booking #{bookingId}? The balance is zero. This marks the booking Checked-Out and updates room availability.</p>
                      <p className="sbill-checkout-rooms">{booking.rooms.map((room) => `${room.BranchName}, room ${room.RoomNumber}`).join("; ")}</p>
                      <div className="sbill-actions"><button className="sbill-button sbill-button-primary" type="button" disabled={blocked} aria-describedby="checkout-confirmation" onClick={() => confirmAction("checkout")}>{pending === "checkout" ? "Checking out…" : "Confirm check-out"}</button><button className="sbill-button sbill-button-secondary" type="button" disabled={blocked} onClick={() => setCheckoutReview(false)}>Not yet</button></div>
                    </> : <><p>The current bill is fully paid. Check-out updates the booking and its room availability.</p><button className="sbill-button sbill-button-primary" type="button" disabled={blocked} onClick={() => { if (busy.current) return; setCheckoutReview(true); setReview(null); setActionError(""); }}>Check out guest <span aria-hidden="true">→</span></button></>}
            </div>
          </section>}
        </div>}

        <div className="sbill-history-layout">
          <section className="sbill-history-section" aria-labelledby="billing-services-heading">
            <div className="sbill-section-heading"><p className="sbill-eyebrow">ITEMISED CHARGES</p><h2 id="billing-services-heading">Service charges</h2></div>
            {!bill.serviceUsage.length ? <p className="sbill-empty">No service charges have been recorded.</p> : <ul className="sbill-history-list" aria-label={`Services recorded for booking #${bookingId}`}>
              {bill.serviceUsage.map((usage) => <li className="sbill-history-entry" key={usage.UsageID}>
                <div className="sbill-entry-heading"><div><p className="sbill-entry-reference">Entry #{usage.UsageID}</p><h3>{usage.ServiceName}</h3></div><p className="sbill-entry-amount"><span>Line total</span>{money.format(Number(usage.LineTotal))}</p></div>
                <dl className="sbill-entry-details"><div className="sbill-entry-date"><dt>Recorded at</dt><dd>{usage.UsageDateDisplay}</dd></div><div><dt>Quantity</dt><dd>{usage.Quantity}</dd></div><div><dt>Saved unit price</dt><dd>{money.format(Number(usage.PriceAtUsage))}</dd></div></dl>
              </li>)}
            </ul>}
          </section>

          <section className="sbill-history-section" aria-labelledby="payment-history-heading">
            <div className="sbill-section-heading"><p className="sbill-eyebrow">RECEIPTS &amp; RECORDS</p><h2 id="payment-history-heading">Payment history</h2></div>
            <p className="sbill-description">Times are shown as recorded by the hotel. A preferred payment method does not confirm a payment.</p>
            {!bill.payments.length ? <p className="sbill-empty">No payments have been recorded for this booking.</p> : <ul className="sbill-history-list" aria-label={`Recorded payments for booking #${bookingId}`}>
              {bill.payments.map((payment) => <li className="sbill-history-entry" key={payment.PaymentID}>
                <div className="sbill-entry-heading"><div><p className="sbill-entry-reference">Payment #{payment.PaymentID}</p><h3>{payment.PaymentMethod}</h3></div><p className="sbill-entry-amount"><span>Amount</span>{money.format(Number(payment.Amount))}</p></div>
                <dl className="sbill-entry-details"><div className="sbill-entry-date"><dt>Recorded at</dt><dd>{payment.PaymentDateDisplay}</dd></div><div><dt>Bill ID</dt><dd>#{payment.BillID}</dd></div><div><dt>Type</dt><dd>{payment.PaymentType}</dd></div></dl>
              </li>)}
            </ul>}
          </section>
        </div>
      </>}
    </section>
  );
}
