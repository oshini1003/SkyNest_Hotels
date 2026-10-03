import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { formatStayDate, isCurrentStaff, loadStaffBooking, staffBookingId } from "../services/staffBookingApi";
import { loadServiceCatalogue } from "../services/serviceCatalogueApi";
import { canRecordServiceUsage, loadServiceBill, saveServiceUsage, serviceQuantity } from "../services/serviceUsageApi";

const initialForm = { serviceId: "", quantity: "1" };
const money = new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR", currencyDisplay: "code" });
const loadingResult = { loading: true, error: "", booking: null, bill: null, services: [], catalogueError: "" };

export default function StaffServiceUsage({ session }) {
  const { id } = useParams();
  const bookingId = staffBookingId(id);
  if (bookingId === null) return <section><h1>Invalid booking reference</h1><p>Choose a reservation from the booking list.</p><Link to="/staff/bookings">Back to bookings</Link></section>;
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
      <p className="eyebrow">STAFF WORKSPACE</p>
      <h1 id="staff-services-heading">Services for booking #{bookingId}</h1>
      <p><Link to={`/staff/bookings/${bookingId}`}>Back to booking</Link> · <Link to={`/staff/bookings/${bookingId}/bill`}>Bill and payments</Link> · <Link to="/staff/bookings">All bookings</Link></p>
      {notice && <p className="form-success" role="status">{notice}</p>}
      {uncertainEntry && <div className="booking-notice" role="alert">
        <p><strong>Check before entering this service again.</strong> The save result for {uncertainEntry.serviceName} × {uncertainEntry.quantity} is unknown. It may already have been saved.</p>
        <p>{needsRefresh || result.loading || result.error ? "Refresh the history and bill below, then check whether this entry appears." : "Review the refreshed history below. If this entry already appears, do not enter it again. A request may still finish after a delay, so an empty history alone does not confirm failure. If you still cannot tell, check with a manager before continuing."}</p>
        {!needsRefresh && !result.loading && !result.error && <button className="button" type="button" onClick={() => { setUncertainEntry(null); clearForm(); }}>I have checked the refreshed history</button>}
      </div>}
      {actionError && <p className="form-error" role="alert">{actionError}</p>}
      {result.loading ? <p role="status">Loading booking, service history and bill…</p>
        : result.error ? <><p className="form-error" role="alert">{result.error}</p><button className="button" type="button" onClick={reload}>Try again</button></>
          : booking && bill && <>
            <div className="card booking-card">
              <div className="booking-card-header"><h2>{booking.GuestName}</h2><span className="booking-status" data-status={booking.BookingStatus}>{booking.BookingStatus}</span></div>
              <h3>Reserved rooms</h3>
              {!booking.rooms.length ? <p>No rooms are assigned to this booking.</p> : <ul>{booking.rooms.map((room) => <li key={room.RoomID}>{room.BranchName} · Room {room.RoomNumber} · {room.RoomTypeName} · {formatStayDate(room.CheckInDate)} to {formatStayDate(room.CheckOutDate)}</li>)}</ul>}
              <p>Service charges are recorded against this booking.</p>
            </div>

            <section className="staff-service-section" aria-labelledby="service-history-heading">
              <h2 id="service-history-heading">Service history</h2>
              <p>Unit prices below are the prices saved when each service was recorded.</p>
              {!bill.serviceUsage.length ? <p>No services have been recorded for this booking.</p> : <div className="staff-booking-table-wrap" role="region" aria-label="Service history" tabIndex="0">
                <table className="staff-booking-table">
                  <caption>Recorded services for booking #{bookingId}</caption>
                  <thead><tr><th scope="col">Entry</th><th scope="col">Recorded at</th><th scope="col">Service</th><th scope="col">Quantity</th><th scope="col">Saved unit price</th><th scope="col">Line total</th></tr></thead>
                  <tbody>{bill.serviceUsage.map((usage) => <tr key={usage.UsageID}><td>#{usage.UsageID}</td><td>{usage.UsageDateDisplay}</td><th scope="row">{usage.ServiceName}</th><td>{usage.Quantity}</td><td>{money.format(Number(usage.PriceAtUsage))}</td><td>{money.format(Number(usage.LineTotal))}</td></tr>)}</tbody>
                </table>
              </div>}
            </section>

            <section className="stay-review" aria-labelledby="service-bill-heading">
              <h2 id="service-bill-heading">{bill.bill ? "Current bill" : "Estimated booking charges"}</h2>
              {!bill.bill && <p>No bill has been opened for this booking. Service entry becomes available after check-in opens the bill.</p>}
              <dl className="stay-details">
                <div><dt>Room charges</dt><dd>{money.format(Number(bill.roomCharges))}</dd></div>
                <div><dt>Service charges</dt><dd>{money.format(Number(bill.serviceCharges))}</dd></div>
                <div><dt>Total amount</dt><dd>{money.format(Number(bill.totalAmount))}</dd></div>
                <div><dt>Outstanding balance</dt><dd>{money.format(Number(bill.outstandingBalance))}</dd></div>
                {bill.bill && <div><dt>Bill status</dt><dd>{bill.bill.BillStatus}</dd></div>}
              </dl>
            </section>

            <p><button className="button" type="button" disabled={pending} onClick={reload}>Refresh history and bill</button></p>

            <section className="staff-service-section" aria-labelledby="service-entry-heading">
              <h2 id="service-entry-heading">Record a service</h2>
              {!permitted ? <p>Your account cannot record service usage.</p>
                : booking.BookingStatus !== "Checked-In" ? <p>Services can only be recorded while this booking is Checked-In. Its service history remains available above.</p>
                  : !bill.bill ? <p>A bill is required before you can record services. Ask reception or a manager to check this booking.</p>
                    : result.catalogueError ? <><p className="form-error" role="alert">{result.catalogueError}</p><button className="button" type="button" onClick={reload}>Retry service catalogue</button></>
                      : !result.services.length ? <p>No active services are available. Refresh the history and bill to check again.</p>
                        : <>
                          {needsRefresh && <p className="booking-notice">Refresh the history and bill before recording another service.</p>}
                          <form className="service-entry-form" onSubmit={reviewEntry}>
                            <div className="form-field"><label htmlFor="usage-service">Service</label><select id="usage-service" name="serviceId" value={form.serviceId} required disabled={blocked} onChange={changeForm}><option value="">Choose a service</option>{result.services.map((service) => <option key={service.ServiceID} value={service.ServiceID}>{service.ServiceName}</option>)}</select></div>
                            <div className="form-field"><label htmlFor="usage-quantity">Quantity</label><input id="usage-quantity" name="quantity" type="number" min="1" max="2147483647" step="1" required value={form.quantity} disabled={blocked} onChange={changeForm} /></div>
                            {selectedService && <p className="service-entry-price">Current unit price: <strong>{money.format(Number(selectedService.UnitPrice))}</strong>{selectedService.Description && <> · {selectedService.Description}</>}</p>}
                            <div className="service-entry-actions"><button className="button" type="submit" disabled={blocked}>Review service entry</button><button className="button service-entry-clear" type="button" disabled={blocked} onClick={clearForm}>Clear form</button></div>
                          </form>
                          {review && <section className="service-entry-review" aria-labelledby="service-review-heading">
                            <h3 id="service-review-heading">Review service entry</h3>
                            <dl><div><dt>Booking</dt><dd>#{bookingId} · {booking.GuestName}</dd></div><div><dt>Service</dt><dd>{review.serviceName}</dd></div><div><dt>Quantity</dt><dd>{review.quantity}</dd></div><div><dt>Estimated unit price</dt><dd>{money.format(review.unitPrice)}</dd></div><div><dt>Estimated line total</dt><dd>{money.format(review.total)}</dd></div></dl>
                            <p id="service-save-confirmation">Confirm this service was used. Saving adds a charge to the booking. The current price at the time of saving is kept with the entry and may differ from this estimate. No payment is taken.</p>
                            <div className="service-entry-actions"><button className="button" type="button" disabled={blocked} aria-describedby="service-save-confirmation" onClick={confirmSave}>{pending ? "Saving service…" : "Confirm and save service"}</button><button className="button service-entry-clear" type="button" disabled={blocked} onClick={() => setReview(null)}>Edit entry</button></div>
                          </section>}
                        </>}
            </section>
          </>}
    </section>
  );
}
