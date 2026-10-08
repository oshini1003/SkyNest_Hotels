import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { formatStayDate, isCurrentStaff, loadStaffBooking, staffBookingId } from "../services/staffBookingApi";
import { loadServiceCatalogue } from "../services/serviceCatalogueApi";
import { canRecordServiceUsage, loadServiceBill, saveServiceUsage, serviceQuantity } from "../services/serviceUsageApi";
import "./StaffServiceUsage.css";

const initialForm = { serviceId: "", quantity: "1" };
const money = new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR", currencyDisplay: "code" });
const loadingResult = { loading: true, error: "", booking: null, bill: null, services: [], catalogueError: "" };

export default function StaffServiceUsage({ session }) {
  const { id } = useParams();
  const bookingId = staffBookingId(id);
  if (bookingId === null) return (
    <section className="staff-services-page" aria-labelledby="invalid-service-booking-heading">
      <div className="ssu-state-panel">
        <p className="ssu-eyebrow">GUEST SERVICES</p>
        <h1 id="invalid-service-booking-heading">Invalid booking reference</h1>
        <p>Choose a reservation from the booking list.</p>
        <Link className="ssu-button ssu-button-primary" to="/staff/bookings">Back to bookings</Link>
      </div>
    </section>
  );
  return <BookingServices key={`${session.token}:${bookingId}`} bookingId={bookingId} session={session} />;
}

function BookingServices({ bookingId, session }) {
  const token = session.token;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(loadingResult);
  const [form, setForm] = useState(initialForm);
  const [review, setReview] = useState(null);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState("");
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [uncertainEntry, setUncertainEntry] = useState(null);
  const [notice, setNotice] = useState("");
  const busy = useRef(false);
  const mutation = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    Promise.allSettled([
      loadStaffBooking(bookingId, token, controller.signal),
      loadServiceBill(bookingId, token, controller.signal),
      loadServiceCatalogue(controller.signal),
    ]).then(([booking, bill, catalogue]) => {
      if (!active || controller.signal.aborted || !isCurrentStaff(token)) return;
      const failure = [booking, bill].find((item) => item.status === "rejected");
      if (failure) {
        setResult({ ...loadingResult, loading: false, error: failure.reason.message });
        return;
      }
      setResult({
        loading: false, error: "", booking: booking.value, bill: bill.value,
        services: catalogue.status === "fulfilled" ? catalogue.value : [],
        catalogueError: catalogue.status === "rejected" ? catalogue.reason.message : "",
      });
      setNeedsRefresh(false);
    });
    return () => { active = false; controller.abort(); };
  }, [bookingId, token, attempt]);
  useEffect(() => () => mutation.current?.abort(), []);

  const booking = result.booking;
  const bill = result.bill;
  const permitted = canRecordServiceUsage(session.staff.role);
  const eligible = permitted && booking?.BookingStatus === "Checked-In" && Boolean(bill?.bill);
  const blocked = pending || needsRefresh || Boolean(uncertainEntry) || result.loading || Boolean(result.error) || Boolean(result.catalogueError);
  const selectedService = result.services.find((service) => String(service.ServiceID) === form.serviceId);

  function reload() {
    if (busy.current) return;
    setReview(null);
    setActionError("");
    setNeedsRefresh(true);
    setResult(loadingResult);
    setAttempt((value) => value + 1);
  }

  function changeForm(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
    setReview(null);
    setActionError("");
    setNotice("");
  }

  function clearForm() {
    setForm(initialForm);
    setReview(null);
    setActionError("");
    setNotice("");
  }

  function reviewEntry(event) {
    event.preventDefault();
    if (busy.current || blocked || !eligible || !isCurrentStaff(token)) return;
    setReview(null);
    setActionError("");
    setNotice("");
    if (!selectedService) {
      setActionError("Please choose an available service.");
      return;
    }
    const quantity = serviceQuantity(form.quantity);
    if (quantity === null) {
      setActionError("Quantity must be a whole number from 1 to 2147483647.");
      return;
    }
    const unitPriceCents = Math.round(Number(selectedService.UnitPrice) * 100);
    const totalCents = unitPriceCents * quantity;
    if (!Number.isSafeInteger(totalCents) || totalCents > 9999999999) {
      setActionError("Quantity is too large for this service. Choose a smaller quantity.");
      return;
    }
    setReview({ serviceId: Number(selectedService.ServiceID), serviceName: selectedService.ServiceName, quantity, unitPrice: unitPriceCents / 100, total: totalCents / 100 });
  }

  async function confirmSave() {
    if (busy.current || blocked || !eligible || !review || !isCurrentStaff(token)) return;
    busy.current = true;
    setPending(true);
    setActionError("");
    const controller = new AbortController();
    mutation.current = controller;
    try {
      await saveServiceUsage({ bookingId, serviceId: review.serviceId, quantity: review.quantity }, token, controller.signal);
      if (controller.signal.aborted || !isCurrentStaff(token)) return;
      setNotice(`${review.serviceName} × ${review.quantity} was saved to booking #${bookingId}. The history shows the saved price.`);
      setForm(initialForm);
      busy.current = false;
      reload();
    } catch (error) {
      if (controller.signal.aborted || !isCurrentStaff(token) || error.name === "AbortError") return;
      setActionError(error.message);
      setNeedsRefresh(true);
      if (error.outcomeUnknown) setUncertainEntry(review);
      setReview(null);
    } finally {
      busy.current = false;
      if (!controller.signal.aborted && isCurrentStaff(token)) setPending(false);
    }
  }

  return (
    <section className="staff-services-page" aria-labelledby="staff-services-heading">
      <nav className="ssu-breadcrumbs" aria-label="Service booking navigation">
        <Link to={`/staff/bookings/${bookingId}`}><span aria-hidden="true">←</span> Back to booking</Link>
        <Link to="/staff/bookings">All bookings</Link>
      </nav>
      <header className="ssu-page-heading">
        <div>
          <p className="ssu-eyebrow">STAFF WORKSPACE · GUEST SERVICES</p>
          <h1 id="staff-services-heading">Services for booking #{bookingId}</h1>
          <p className="ssu-introduction">Record the details of a guest’s stay, one service at a time.</p>
        </div>
        {booking && <span className="ssu-status" data-status={booking.BookingStatus}>{booking.BookingStatus}</span>}
      </header>

      {notice && <p className="ssu-notice ssu-notice-success" role="status">{notice}</p>}
      {uncertainEntry && <div className="ssu-notice ssu-notice-warning" role="alert">
        <p><strong>Check before entering this service again.</strong> The save result for {uncertainEntry.serviceName} × {uncertainEntry.quantity} is unknown. It may already have been saved.</p>
        <p>{needsRefresh || result.loading || result.error ? "Refresh the history and bill below, then check whether this entry appears." : "Review the refreshed history below. If this entry already appears, do not enter it again. A request may still finish after a delay, so an empty history alone does not confirm failure. If you still cannot tell, check with a manager before continuing."}</p>
        {!needsRefresh && !result.loading && !result.error && <button className="ssu-button ssu-button-secondary" type="button" onClick={() => { setUncertainEntry(null); clearForm(); }}>I have checked the refreshed history</button>}
      </div>}
      {actionError && <p className="ssu-notice ssu-notice-error" role="alert">{actionError}</p>}

      {result.loading ? <div className="ssu-state-panel" role="status"><p className="ssu-eyebrow">PREPARING YOUR WORKSPACE</p><h2>Loading the stay</h2><p>Loading booking, service history and bill…</p></div>
        : result.error ? <div className="ssu-state-panel"><p className="ssu-eyebrow">GUEST SERVICES</p><h2>Unable to load this stay</h2><p className="ssu-error-copy" role="alert">{result.error}</p><button className="ssu-button ssu-button-primary" type="button" onClick={reload}>Try again</button></div>
          : booking && bill && <div className="ssu-layout">
            <aside className="ssu-bill-rail" aria-labelledby="service-bill-heading">
              <section className="ssu-bill-panel">
                <div className="ssu-bill-heading">
                  <p className="ssu-eyebrow">STAY ACCOUNT · #{bookingId}</p>
                  <h2 id="service-bill-heading">{bill.bill ? "Current bill" : "Estimated booking charges"}</h2>
                  {bill.bill && <p className="ssu-bill-status">Bill status <strong>{bill.bill.BillStatus}</strong></p>}
                </div>
                <div className="ssu-bill-body">
                  {!bill.bill && <p className="ssu-body-copy">No bill has been opened for this booking. Service entry becomes available after check-in opens the bill.</p>}
                  <dl className="ssu-bill-details">
                    <div><dt>Room charges</dt><dd>{money.format(Number(bill.roomCharges))}</dd></div>
                    <div><dt>Service charges</dt><dd>{money.format(Number(bill.serviceCharges))}</dd></div>
                    <div className="ssu-bill-total"><dt>Total amount</dt><dd>{money.format(Number(bill.totalAmount))}</dd></div>
                    <div className="ssu-bill-outstanding"><dt>Outstanding balance</dt><dd>{money.format(Number(bill.outstandingBalance))}</dd></div>
                  </dl>
                  <Link className="ssu-button ssu-button-primary" to={`/staff/bookings/${bookingId}/bill`}>Bill and payments <span aria-hidden="true">→</span></Link>
                  <p className="ssu-panel-note">Recording a service adds a charge to this booking. No payment is taken here.</p>
                  <button className="ssu-refresh-button" type="button" disabled={pending} onClick={reload}>Refresh history and bill <span aria-hidden="true">↻</span></button>
                </div>
              </section>
            </aside>

            <div className="ssu-workspace">
              <section className="ssu-guest-panel" aria-labelledby="service-guest-heading">
                <div className="ssu-guest-heading">
                  <span className="ssu-guest-symbol" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-3a7 7 0 0 1 14 0v3" /></svg></span>
                  <div><p className="ssu-eyebrow">YOUR GUEST</p><h2 id="service-guest-heading">{booking.GuestName}</h2></div>
                </div>
                <h3 className="ssu-room-label">Reserved rooms</h3>
                {!booking.rooms.length ? <p className="ssu-body-copy">No rooms are assigned to this booking.</p> : <ul className="ssu-room-list">
                  {booking.rooms.map((room) => <li key={room.RoomID}>
                    <p className="ssu-room-title"><strong>{room.BranchName}</strong><span>Room {room.RoomNumber} · {room.RoomTypeName}</span></p>
                    <p className="ssu-room-dates">{formatStayDate(room.CheckInDate)} <span>to</span> {formatStayDate(room.CheckOutDate)}</p>
                  </li>)}
                </ul>}
                <p className="ssu-panel-note">Service charges are recorded against this booking.</p>
              </section>

              <section className="ssu-entry-section" aria-labelledby="service-entry-heading">
                <div className="ssu-section-heading"><p className="ssu-eyebrow">ADD TO THE STAY</p><h2 id="service-entry-heading">Record a service</h2></div>
                {!permitted ? <p className="ssu-empty-note">Your account cannot record service usage.</p>
                  : booking.BookingStatus !== "Checked-In" ? <p className="ssu-empty-note">Services can only be recorded while this booking is Checked-In. Its service history remains available below.</p>
                    : !bill.bill ? <p className="ssu-empty-note">A bill is required before you can record services. Ask reception or a manager to check this booking.</p>
                      : result.catalogueError ? <div className="ssu-empty-note"><p className="ssu-error-copy" role="alert">{result.catalogueError}</p><button className="ssu-button ssu-button-secondary" type="button" onClick={reload}>Retry service catalogue</button></div>
                        : !result.services.length ? <p className="ssu-empty-note">No active services are available. Refresh the history and bill to check again.</p>
                          : <>
                            {needsRefresh && <p className="ssu-notice ssu-notice-warning">Refresh the history and bill before recording another service.</p>}
                            <form className="ssu-entry-form" onSubmit={reviewEntry}>
                              <p className="ssu-form-introduction">Choose the service used by this guest, then review the quantity and charge before saving.</p>
                              <div className="ssu-form-fields">
                                <div className="ssu-field"><label htmlFor="usage-service">Service</label><select id="usage-service" name="serviceId" value={form.serviceId} required disabled={blocked} onChange={changeForm}><option value="">Choose a service</option>{result.services.map((service) => <option key={service.ServiceID} value={service.ServiceID}>{service.ServiceName}</option>)}</select></div>
                                <div className="ssu-field"><label htmlFor="usage-quantity">Quantity</label><input id="usage-quantity" name="quantity" type="number" min="1" max="2147483647" step="1" required value={form.quantity} disabled={blocked} onChange={changeForm} /></div>
                              </div>
                              {selectedService && <div className="ssu-service-price"><p>Current unit price <strong>{money.format(Number(selectedService.UnitPrice))}</strong></p>{selectedService.Description && <p className="ssu-service-description">{selectedService.Description}</p>}</div>}
                              <div className="ssu-entry-actions"><button className="ssu-button ssu-button-primary" type="submit" disabled={blocked}>Review service entry</button><button className="ssu-button ssu-button-secondary" type="button" disabled={blocked} onClick={clearForm}>Clear form</button></div>
                            </form>
                            {review && <section className="ssu-entry-review" aria-labelledby="service-review-heading">
                              <p className="ssu-eyebrow">CHECK BEFORE SAVING</p>
                              <h3 id="service-review-heading">Review service entry</h3>
                              <dl className="ssu-review-details"><div><dt>Booking</dt><dd>#{bookingId} · {booking.GuestName}</dd></div><div><dt>Service</dt><dd>{review.serviceName}</dd></div><div><dt>Quantity</dt><dd>{review.quantity}</dd></div><div><dt>Estimated unit price</dt><dd>{money.format(review.unitPrice)}</dd></div><div className="ssu-review-total"><dt>Estimated line total</dt><dd>{money.format(review.total)}</dd></div></dl>
                              <p id="service-save-confirmation" className="ssu-save-confirmation">Confirm this service was used. Saving adds a charge to the booking. The current price at the time of saving is kept with the entry and may differ from this estimate. No payment is taken.</p>
                              <div className="ssu-entry-actions"><button className="ssu-button ssu-button-primary" type="button" disabled={blocked} aria-describedby="service-save-confirmation" onClick={confirmSave}>{pending ? "Saving service…" : "Confirm and save service"}</button><button className="ssu-button ssu-button-secondary" type="button" disabled={blocked} onClick={() => setReview(null)}>Edit entry</button></div>
                            </section>}
                          </>}
              </section>

              <section className="ssu-history-section" aria-labelledby="service-history-heading">
                <div className="ssu-section-heading"><p className="ssu-eyebrow">SAVED TO THIS BOOKING</p><h2 id="service-history-heading">Service history</h2><p className="ssu-body-copy">Unit prices below are the prices saved when each service was recorded.</p></div>
                {!bill.serviceUsage.length ? <div className="ssu-empty-note"><strong>No services recorded yet</strong><p>No services have been recorded for this booking.</p></div> : <ul className="ssu-history-list" aria-label={`Recorded services for booking #${bookingId}`}>
                  {bill.serviceUsage.map((usage) => <li className="ssu-history-card" key={usage.UsageID}>
                    <div className="ssu-history-top"><div><p className="ssu-entry-reference">Entry #{usage.UsageID}</p><h3>{usage.ServiceName}</h3></div><div className="ssu-line-total"><span>Line total</span><strong>{money.format(Number(usage.LineTotal))}</strong></div></div>
                    <dl className="ssu-history-details"><div><dt>Quantity</dt><dd>{usage.Quantity}</dd></div><div><dt>Saved unit price</dt><dd>{money.format(Number(usage.PriceAtUsage))}</dd></div><div><dt>Recorded at</dt><dd>{usage.UsageDateDisplay}</dd></div></dl>
                  </li>)}
                </ul>}
              </section>
            </div>
          </div>}
    </section>
  );
}
