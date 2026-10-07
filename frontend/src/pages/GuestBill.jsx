import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { isCurrentGuest } from "../services/bookingApi";
import { formatBillMoney, guestBillId, loadGuestBill } from "../services/guestBillingApi";
import { SESSION_CHANGED_EVENT } from "../services/session";
import "./GuestBill.css";

const dateFormatter = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const emptyResult = { loading: true, error: "", status: 0, data: null };

function RecordedDate({ value }) {
  // These are hotel-local calendar values, not UTC instants. Keep the saved
  // clock time rather than shifting it into the browser's time zone.
  const [date, clock] = value.split(" ");
  return <time dateTime={`${date}T${clock}`}>{dateFormatter.format(new Date(`${date}T00:00:00Z`))}<span className="gb-date-clock">{clock}</span></time>;
}

export default function GuestBill({ session }) {
  const { id } = useParams();
  const bookingId = guestBillId(id);
  if (bookingId === null) return (
    <section className="guest-bill-page" aria-labelledby="guest-bill-heading">
      <Link className="gb-back-link" to="/guest/bookings"><span aria-hidden="true">←</span> My bookings</Link>
      <div className="gb-state-panel">
        <BillIcon />
        <h1 id="guest-bill-heading">Invalid booking reference</h1>
        <p>Choose a reservation from My bookings to view its bill and history.</p>
      </div>
    </section>
  );
  // Remount immediately on route or account changes, before any old request
  // can place the previous booking's bill in the new view.
  return <BookingBill key={`${session.token}:${bookingId}`} bookingId={bookingId} token={session.token} />;
}

function BookingBill({ bookingId, token }) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(emptyResult);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    function sessionChanged() {
      if (isCurrentGuest(token)) return;
      controller.abort();
      if (active) setResult({ loading: false, error: "Your session has changed. Sign in to view your booking.", status: 401, data: null });
    }
    window.addEventListener(SESSION_CHANGED_EVENT, sessionChanged);
    loadGuestBill(bookingId, token, controller.signal).then((data) => {
      if (active && !controller.signal.aborted && isCurrentGuest(token)) setResult({ loading: false, error: "", status: 0, data });
    }).catch((error) => {
      if (active && !controller.signal.aborted && isCurrentGuest(token) && error.name !== "AbortError") {
        setResult({ loading: false, error: error.message, status: error.status || 0, data: null });
      }
    });
    return () => {
      active = false;
      controller.abort();
      window.removeEventListener(SESSION_CHANGED_EVENT, sessionChanged);
    };
  }, [bookingId, token, attempt]);

  function refresh() {
    if (result.loading || !isCurrentGuest(token)) return;
    setResult(emptyResult);
    setAttempt((value) => value + 1);
  }

  const data = isCurrentGuest(token) ? result.data : null;
  return (
    <section className="guest-bill-page" aria-labelledby="guest-bill-heading" aria-busy={result.loading}>
      <Link className="gb-back-link" to="/guest/bookings"><span aria-hidden="true">←</span> My bookings</Link>
      <header className="gb-page-heading">
        <div>
          <p className="gb-eyebrow">YOUR SKYNEST STAY</p>
          <h1 id="guest-bill-heading">Your bill &amp; stay history</h1>
          <p className="gb-introduction">A clear view of your room charges, services and recorded payments.</p>
        </div>
        <button className="gb-button" type="button" disabled={result.loading || !isCurrentGuest(token)} onClick={refresh}>
          <span aria-hidden="true">↻</span> {result.loading ? "Loading…" : "Refresh bill"}
        </button>
      </header>
      {result.loading ? (
        <div className="gb-state-panel" role="status"><BillIcon /><h2>Loading your bill…</h2><p>Retrieving the latest details for booking #{bookingId}.</p></div>
      ) : result.error ? (
        <div className="gb-state-panel">
          <BillIcon />
          <h2>{result.status === 404 ? "Booking not available" : "We could not load your bill"}</h2>
          <p className="gb-error" role="alert">{result.error}</p>
          {result.status !== 401 && <button className="gb-button" type="button" onClick={refresh}>Try again</button>}
        </div>
      ) : data ? <BillContent data={data} /> : <p className="gb-notice" role="status">Sign in to view your booking.</p>}
    </section>
  );
}

function BillContent({ data }) {
  const saved = Boolean(data.bill);
  const cancelledWithoutBill = !saved && data.bookingStatus === "Cancelled";
  const balanceText = String(data.outstandingBalance);
  const credit = balanceText.startsWith("-") && !/^-0(?:\.0{1,2})?$/.test(balanceText);
  const settled = /^0(?:\.0{1,2})?$/.test(balanceText);
  return (
    <>
      <div className="gb-reference-bar">
        <dl className="gb-references">
          <div><dt>Reservation</dt><dd>Booking #{data.bookingId}</dd></div>
          <div><dt>{saved ? "Bill reference" : "Bill"}</dt><dd>{saved ? `#${data.bill.BillID}` : "Not issued"}</dd></div>
        </dl>
        <span className="gb-status" data-status={data.bookingStatus}>{data.bookingStatus}</span>
      </div>
      {cancelledWithoutBill ? (
        <div className="gb-cancelled-note">
          <BillIcon />
          <div><h2>No bill has been issued</h2><p>This reservation is cancelled. Estimated room charges are not shown as an amount owed.</p></div>
        </div>
      ) : (
        <div className="gb-summary-grid">
          <section className="gb-charge-summary" aria-labelledby="gb-charges-heading">
            <p className="gb-eyebrow">{saved ? "YOUR BILL AT A GLANCE" : "PLAN YOUR STAY"}</p>
            <h2 id="gb-charges-heading">{saved ? "Charge summary" : "Estimated charges"}</h2>
            <p className="gb-section-copy">{saved ? "Room charges are the total recorded on your bill. Services are itemized below." : "A bill has not been issued yet. These estimated charges may change before your stay and are not an invoice."}</p>
            <dl className="gb-charge-lines">
              <div><dt>{saved ? "Recorded room charges" : "Estimated room charges"}</dt><dd>{formatBillMoney(data.roomCharges)}</dd></div>
              <div><dt>{saved ? "Service charges" : "Services recorded so far"}</dt><dd>{formatBillMoney(data.serviceCharges)}</dd></div>
              <div className="gb-total-line"><dt>{saved ? "Total bill" : "Estimated total"}</dt><dd>{formatBillMoney(data.totalAmount)}</dd></div>
            </dl>
          </section>
          <aside className={`gb-balance-panel${saved ? "" : " gb-balance-estimate"}`} aria-labelledby="gb-balance-heading">
            <p className="gb-eyebrow">{saved ? "PAYMENT SUMMARY" : "BEFORE CHECK-IN"}</p>
            <h2 id="gb-balance-heading">{saved ? (credit ? "Credit balance" : "Outstanding balance") : "Your bill comes later"}</h2>
            {saved ? (
              <>
                <p className="gb-balance-amount">{formatBillMoney(data.outstandingBalance)}</p>
                <span className="gb-payment-status" data-status={data.bill.BillStatus}>{data.bill.BillStatus}</span>
                <dl className="gb-paid-total"><div><dt>Payments recorded</dt><dd>{formatBillMoney(data.paidAmount)}</dd></div></dl>
                <p className="gb-balance-note">{credit ? "Please contact reception to review this credit balance." : settled ? "Your recorded payments cover the total bill." : "For payments or questions about your bill, please speak with reception."}</p>
              </>
            ) : <p className="gb-estimate-copy">You can review your issued bill and payment history here after check-in. For questions about this estimate, please contact reception.</p>}
          </aside>
        </div>
      )}
      {saved && data.bookingStatus === "Checked-In" && (
        <aside className="gb-service-invitation" aria-label="Services during your stay">
          <div><h2>A little extra for your stay</h2><p>Browse services, review the estimated charge and add a request to your bill.</p></div>
          <Link className="gb-button" to={`/guest/bookings/${data.bookingId}/services`}>Request a service <span aria-hidden="true">↗</span></Link>
        </aside>
      )}
      <section className="gb-history-section" aria-labelledby="gb-services-heading">
        <header className="gb-section-heading"><div><p className="gb-eyebrow">DURING YOUR STAY</p><h2 id="gb-services-heading">Service history</h2></div><span className="gb-entry-count">{data.serviceUsage.length} {data.serviceUsage.length === 1 ? "entry" : "entries"}</span></header>
        <p className="gb-section-copy">Each charge uses the unit price recorded when the service was added to your stay.</p>
        {data.serviceUsage.length ? (
          <div className="gb-table-wrap" role="region" aria-label="Itemized service history" tabIndex="0">
            <table className="gb-history-table gb-services-table">
              <caption>Services for booking #{data.bookingId}. Times are shown as recorded by the hotel.</caption>
              <thead><tr><th scope="col">Service</th><th scope="col">Recorded at</th><th scope="col" className="gb-number">Quantity</th><th scope="col" className="gb-number">Unit price</th><th scope="col" className="gb-number">Charge</th></tr></thead>
              <tbody>{data.serviceUsage.map((usage) => <tr key={usage.UsageID}>
                <th scope="row">{usage.ServiceName}<span className="gb-row-detail">Entry #{usage.UsageID}</span></th>
                <td><RecordedDate value={usage.UsageDateDisplay} /></td>
                <td className="gb-number">{usage.Quantity}</td>
                <td className="gb-number">{formatBillMoney(usage.PriceAtUsage)}</td>
                <td className="gb-number gb-amount">{formatBillMoney(usage.LineTotal)}</td>
              </tr>)}</tbody>
              <tfoot><tr><th scope="row" colSpan="4">Total service charges</th><td className="gb-number">{formatBillMoney(data.serviceCharges)}</td></tr></tfoot>
            </table>
          </div>
        ) : <p className="gb-empty-history">No services have been recorded for this booking.</p>}
      </section>
      <section className="gb-history-section" aria-labelledby="gb-payments-heading">
        <header className="gb-section-heading"><div><p className="gb-eyebrow">YOUR PAYMENT RECORD</p><h2 id="gb-payments-heading">Payment history</h2></div><span className="gb-entry-count">{data.payments.length} {data.payments.length === 1 ? "payment" : "payments"}</span></header>
        <p className="gb-section-copy">These entries confirm payments recorded by the hotel. Each payment keeps its original Full or Partial classification.</p>
        {data.payments.length ? (
          <div className="gb-table-wrap" role="region" aria-label="Recorded payment history" tabIndex="0">
            <table className="gb-history-table gb-payments-table">
              <caption>Payments for booking #{data.bookingId}. Times are shown as recorded by the hotel.</caption>
              <thead><tr><th scope="col">Reference</th><th scope="col">Recorded at</th><th scope="col">Method</th><th scope="col">Payment type</th><th scope="col" className="gb-number">Amount</th></tr></thead>
              <tbody>{data.payments.map((payment) => <tr key={payment.PaymentID}>
                <th scope="row">Payment #{payment.PaymentID}<span className="gb-row-detail">Bill #{payment.BillID}</span></th>
                <td><RecordedDate value={payment.PaymentDateDisplay} /></td>
                <td>{payment.PaymentMethod}</td>
                <td>{payment.PaymentType}</td>
                <td className="gb-number gb-amount">{formatBillMoney(payment.Amount)}</td>
              </tr>)}</tbody>
              <tfoot><tr><th scope="row" colSpan="4">Total recorded payments</th><td className="gb-number">{formatBillMoney(data.paidAmount)}</td></tr></tfoot>
            </table>
          </div>
        ) : <p className="gb-empty-history">No payments have been recorded for this booking.</p>}
      </section>
      <footer className="gb-page-note"><p>Questions about an entry? Contact reception and quote booking #{data.bookingId}{saved ? ` and bill #${data.bill.BillID}` : ""}.</p><Link to="/guest/bookings">Back to My bookings <span aria-hidden="true">→</span></Link></footer>
    </>
  );
}

function BillIcon() {
  return <svg className="gb-bill-icon" width="40" height="44" viewBox="0 0 40 44" fill="none" aria-hidden="true"><path d="M9 5h22v34l-4-3-4 3-3-3-4 3-3-3-4 3V5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M15 14h10M15 20h10M15 26h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
}
