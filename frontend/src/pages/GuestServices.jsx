import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { isCurrentGuest } from "../services/bookingApi";
import { formatBillMoney, guestBillId, loadGuestBill } from "../services/guestBillingApi";
import { clearGuestServiceAttempt, guestServiceTotal, loadGuestServiceCatalogue, readGuestServiceAttempt, requestGuestService } from "../services/guestServiceApi";
import { SESSION_CHANGED_EVENT } from "../services/session";
import "./GuestServices.css";

const initialResult = { loading: true, data: null, error: "", status: 0, services: [], catalogueError: "" };
const dateFormatter = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

function serviceImage(name) {
  if (/dining|restaurant|food|breakfast|lunch|dinner/i.test(name)) return "/images/hotel/service-dining.jpg";
  if (/spa|massage|wellness/i.test(name)) return "/images/hotel/service-spa.jpg";
  return null;
}

function ServiceIcon({ name = "", className = "" }) {
  let drawing;
  if (/laundry/i.test(name)) drawing = <><path d="M16 21h32a6 6 0 0 1 0 12H16a6 6 0 0 1 0-12ZM14 33h34a6 6 0 0 1 0 12H14a6 6 0 0 1 0-12ZM13 27h27M12 39h25M11 45h42" /><path d="M26 21v12M37 33v12" /></>;
  else if (/transfer|airport|transport/i.test(name)) drawing = <><path d="m13 31 5-13h28l5 13M10 31h44v17H10zM17 48v6M47 48v6M20 39h3M41 39h3M25 31h14" /><path d="M22 12h20" /></>;
  else if (/mini\s*bar/i.test(name)) drawing = <><path d="M16 12h11v6H16zM18 18v8c0 4-6 6-6 11v15h19V37c0-5-6-7-6-11v-8M12 36h19M12 44h19M40 27h13l-2 13a5 5 0 0 1-9 0l-2-13ZM41 34h11M46 44v9M41 53h10" /></>;
  else if (/room\s*service/i.test(name)) drawing = <><circle cx="34" cy="32" r="13" /><circle cx="34" cy="32" r="8" /><path d="M10 18v10a4 4 0 0 0 8 0V18M14 18v31M55 49V18c-5 4-6 10-6 18h6" /></>;
  else drawing = <><path d="M10 43h44M15 43v-3a17 17 0 0 1 34 0v3M8 50h48M32 23v-7M27 16h10M21 36a12 12 0 0 1 6-7" /></>;
  return <svg className={`gs-service-icon ${className}`} viewBox="0 0 64 64" fill="none" aria-hidden="true">{drawing}</svg>;
}

function RecordedDate({ value }) {
  const [date, clock] = value.split(" ");
  return <time dateTime={`${date}T${clock}`}>{dateFormatter.format(new Date(`${date}T00:00:00Z`))}<span>{clock}</span></time>;
}

export default function GuestServices({ session }) {
  const { id } = useParams();
  const bookingId = guestBillId(id);
  const guestId = guestBillId(session?.guest?.guestId);
  if (bookingId === null || guestId === null) return <section className="guest-services-page"><Link className="gs-back-link" to="/guest/bookings">← My bookings</Link><div className="gs-state"><ServiceIcon /><h1>Choose your reservation</h1><p>Open a booking from My bookings to arrange services for your stay.</p></div></section>;
  return <BookingServices key={`${session.token}:${bookingId}`} bookingId={bookingId} guestId={guestId} token={session.token} />;
}

function BookingServices({ bookingId, guestId, token }) {
  const [initialAttempt] = useState(() => {
    try { return { entry: readGuestServiceAttempt(guestId, bookingId), error: "" }; }
    catch (error) { return { entry: null, error: error.message }; }
  });
  const [result, setResult] = useState(initialResult);
  const [marker, setMarker] = useState(initialAttempt.entry);
  const [storageError, setStorageError] = useState(initialAttempt.error);
  const [selectedId, setSelectedId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [search, setSearch] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const mounted = useRef(false);
  const busy = useRef(false);
  const requestController = useRef(null);
  const readController = useRef(null);
  const knownSaved = useRef(false);
  const reviewPanel = useRef(null);

  const active = useCallback((controller) => mounted.current && !controller.signal.aborted && isCurrentGuest(token), [token]);

  const refreshSnapshot = useCallback(async (controller) => {
    setResult(initialResult);
    const [bill, catalogue] = await Promise.allSettled([
      loadGuestBill(bookingId, token, controller.signal),
      loadGuestServiceCatalogue(token, controller.signal),
    ]);
    if (!active(controller)) return;
    if (bill.status === "rejected") {
      setResult({ ...initialResult, loading: false, error: bill.reason.message, status: bill.reason.status || 0 });
      return;
    }
    // A saved acknowledgement plus a fresh verified bill permits a new request.
    // A pending attempt is deliberately never matched to a similar history row.
    try {
      const stored = readGuestServiceAttempt(guestId, bookingId);
      if (knownSaved.current || stored?.stage === "saved") {
        clearGuestServiceAttempt(guestId, bookingId);
        knownSaved.current = false;
        setMarker(null);
        setNotice("Your service request was saved. Your latest charges and service history are shown below.");
      } else setMarker(stored);
      setStorageError("");
    } catch (error) { setStorageError(error.message); }
    setResult({ loading: false, data: bill.value, error: "", status: 0, services: catalogue.status === "fulfilled" ? catalogue.value : [], catalogueError: catalogue.status === "rejected" ? catalogue.reason.message : "" });
  }, [active, bookingId, guestId, token]);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    readController.current = controller;
    function changed() {
      if (isCurrentGuest(token)) return;
      readController.current?.abort();
      requestController.current?.abort();
      setResult({ ...initialResult, loading: false, error: "Your session has changed. Sign in again to view your stay.", status: 401 });
      setNotice("");
      setActionError("");
      setPending(false);
    }
    window.addEventListener(SESSION_CHANGED_EVENT, changed);
    refreshSnapshot(controller);
    return () => {
      mounted.current = false;
      readController.current?.abort();
      requestController.current?.abort();
      window.removeEventListener(SESSION_CHANGED_EVENT, changed);
    };
  }, [refreshSnapshot, token]);

  async function refresh() {
    if (busy.current || result.loading || !isCurrentGuest(token)) return;
    busy.current = true;
    setConfirmed(false);
    const controller = new AbortController();
    readController.current = controller;
    try { await refreshSnapshot(controller); }
    finally { busy.current = false; }
  }

  const sessionActive = isCurrentGuest(token);
  const data = sessionActive ? result.data : null;
  const eligible = data?.bookingStatus === "Checked-In" && Boolean(data.bill);
  const blocked = pending || result.loading || Boolean(result.error) || Boolean(result.catalogueError) || Boolean(marker) || Boolean(storageError) || !eligible || !isCurrentGuest(token);
  const selected = result.services.find((service) => String(service.ServiceID) === selectedId);
  const estimatedTotal = selected ? guestServiceTotal(selected.UnitPrice, quantity) : null;
  const query = search.trim().toLowerCase();
  const visible = result.services.filter((service) => `${service.ServiceName} ${service.Description || ""}`.toLowerCase().includes(query));
  const showSelectionBar = Boolean(selected && eligible && !blocked);

  function selectService(serviceId) {
    if (blocked || busy.current) return;
    setSelectedId(String(serviceId));
    setConfirmed(false);
    setActionError("");
    setNotice("");
  }

  async function submit(event) {
    event.preventDefault();
    if (busy.current || blocked || !selected || !confirmed || estimatedTotal === null) return;
    busy.current = true;
    setPending(true);
    setConfirmed(false);
    setActionError("");
    setNotice("");
    const controller = new AbortController();
    requestController.current = controller;
    try {
      await requestGuestService({ bookingId, serviceId: selected.ServiceID, quantity: Number(quantity) }, token, controller.signal);
      if (!active(controller)) return;
      knownSaved.current = true;
      setMarker({ guestId, bookingId, serviceId: selected.ServiceID, quantity: Number(quantity), stage: "saved" });
      setNotice(`${selected.ServiceName} × ${quantity} was saved to your bill. Refreshing your history…`);
      setSelectedId("");
      setQuantity("1");
      await refreshSnapshot(controller);
    } catch (error) {
      if (!active(controller)) return;
      if (error.saved) {
        knownSaved.current = true;
        setMarker({ guestId, bookingId, serviceId: selected.ServiceID, quantity: Number(quantity), stage: "saved" });
        setNotice("Your service was saved. We are checking the latest bill before you can make another request.");
        setSelectedId("");
        setQuantity("1");
      } else setActionError(error.message);
      try {
        const stored = readGuestServiceAttempt(guestId, bookingId);
        if (!error.saved) setMarker(stored);
      }
      catch (storageFailure) { setStorageError(storageFailure.message); }
      await refreshSnapshot(controller);
    } finally {
      busy.current = false;
      if (active(controller)) setPending(false);
    }
  }

  function acknowledgeUncertainRequest() {
    if (busy.current || pending || result.loading || !data || marker?.stage !== "pending" || !isCurrentGuest(token)) return;
    try {
      clearGuestServiceAttempt(guestId, bookingId);
      setMarker(null);
      setStorageError("");
      setActionError("");
      setSelectedId("");
      setQuantity("1");
      setConfirmed(false);
      setNotice("You have confirmed that reception has checked this request. You can now make a new request if needed.");
    } catch (error) { setStorageError(error.message); }
  }

  return <section className={`guest-services-page${showSelectionBar ? " gs-has-selection" : ""}`} aria-labelledby="guest-services-heading">
    <nav className="gs-breadcrumbs" aria-label="Booking navigation"><Link className="gs-back-link" to="/guest/bookings">← My bookings</Link><Link className="gs-back-link" to={`/guest/bookings/${bookingId}/bill`}>View bill &amp; history →</Link></nav>
    <header className="gs-heading"><div><p className="gs-eyebrow">A LITTLE MORE COMFORT</p><h1 id="guest-services-heading">Make the stay yours<span>.</span></h1><p className="gs-introduction">Good food, a moment to unwind, the everyday details taken care of. Choose a service for your SkyNest stay.</p></div><div className="gs-heading-mark"><ServiceIcon /><span>AT YOUR SERVICE</span></div></header>
    <div className="gs-reference-bar"><div><span className="gs-small-label">YOUR RESERVATION</span><strong>Booking #{bookingId}</strong></div>{data && <span className="gs-status" data-status={data.bookingStatus}>{data.bookingStatus}</span>}<button className="gs-button gs-refresh" type="button" disabled={pending || result.loading || !isCurrentGuest(token)} onClick={refresh}><span aria-hidden="true">↻</span> {result.loading ? "Refreshing…" : "Refresh stay"}</button></div>

    {sessionActive && notice && <div className="gs-notice gs-success" role="status"><strong>Request update</strong><p>{notice}</p></div>}
    {sessionActive && marker?.stage === "pending" && <div className="gs-notice gs-warning" role="alert"><strong>Please check your previous request</strong><p>We could not confirm whether service #{marker.serviceId} × {marker.quantity} was saved. It may already be on your bill. Do not submit it again until reception has checked it.</p><p>{data ? "Your refreshed history is shown below. A delayed request can still finish, so a missing entry alone does not mean it failed." : "Refresh your stay to load the latest history, then ask reception to confirm this request."}</p>{data && !result.loading && <button className="gs-button" type="button" disabled={pending} onClick={acknowledgeUncertainRequest}>I have checked this request with reception</button>}</div>}
    {sessionActive && marker?.stage === "saved" && <div className="gs-notice" role="status"><strong>Your request has been saved</strong><p>Refresh your stay to verify the latest bill before making another request.</p></div>}
    {storageError && <div className="gs-notice gs-warning" role="alert"><strong>Requests are temporarily unavailable</strong><p>{storageError}</p><p>Please check your browser storage settings, then refresh this stay. If a request was already in progress, speak with reception before entering it again.</p></div>}
    {actionError && <p className="gs-notice gs-warning" role="alert">{actionError}</p>}

    {result.loading ? <div className="gs-state" role="status"><ServiceIcon /><h2>Preparing your stay details…</h2><p>Checking your bill and the latest service catalogue.</p></div>
      : result.error ? <div className="gs-state"><ServiceIcon /><h2>{result.status === 404 ? "Booking not available" : "We could not load your stay"}</h2><p className="gs-error" role="alert">{result.error}</p>{result.status !== 401 && <button className="gs-button" type="button" onClick={refresh}>Try again</button>}</div>
        : data && <>
          {!eligible && <div className="gs-notice"><strong>{data.bookingStatus === "Booked" ? "Services open after check-in" : data.bookingStatus === "Checked-Out" ? "Thank you for staying with us" : data.bookingStatus === "Cancelled" ? "This reservation is cancelled" : "Your bill is not ready yet"}</strong><p>{data.bookingStatus === "Booked" ? "Once reception has checked you in and opened your bill, you can request services here." : data.bookingStatus === "Checked-Out" ? "This stay is complete, so new service requests are closed. Your saved history is still available below." : data.bookingStatus === "Cancelled" ? "New services cannot be requested for a cancelled booking." : "Please ask reception to check your bill before requesting a service."}</p></div>}
          {eligible && <form className="gs-request-layout" onSubmit={submit}>
            <section className="gs-catalogue" aria-labelledby="gs-catalogue-heading"><div className="gs-section-heading"><div><p className="gs-eyebrow">01 / CHOOSE A SERVICE</p><h2 id="gs-catalogue-heading">The details of a good stay.</h2></div></div>
              {result.catalogueError ? <div className="gs-notice gs-warning"><p role="alert">{result.catalogueError}</p><button className="gs-button" type="button" onClick={refresh} disabled={pending}>Reload catalogue</button></div>
                : <><label className="gs-search-label" htmlFor="gs-search">Find a service</label><div className="gs-search"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg><input id="gs-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Try breakfast, laundry or spa" /><span aria-live="polite">{visible.length} {visible.length === 1 ? "service" : "services"}</span></div>
                  {!result.services.length ? <div className="gs-empty"><ServiceIcon /><h3>No services available right now</h3><p>Please ask reception for assistance or refresh this stay later.</p></div> : !visible.length ? <div className="gs-empty"><h3>No matching services</h3><p>Try a different name or clear your search.</p><button className="gs-button" type="button" onClick={() => setSearch("")}>Clear search</button></div>
                    : <fieldset className="gs-service-options" disabled={blocked}><legend className="gs-sr-only">Select one service to add to this booking</legend>{visible.map((service) => {
                      const image = serviceImage(service.ServiceName);
                      const checked = selectedId === String(service.ServiceID);
                      return <label className={`gs-service-card${checked ? " gs-service-selected" : ""}`} key={service.ServiceID}>
                        <input className="gs-service-radio" type="radio" name="service" value={service.ServiceID} checked={checked} onChange={() => selectService(service.ServiceID)} />
                        <div className={`gs-service-media${image ? "" : " gs-service-media-icon"}`}>{image ? <img src={image} alt="" loading="lazy" /> : <ServiceIcon name={service.ServiceName} />}<span className="gs-selection-mark" aria-hidden="true">{checked ? "✓" : "+"}</span></div>
                        <div className="gs-service-body"><h3>{service.ServiceName}</h3><p>{service.Description || "Please speak with reception if you would like more details."}</p><div className="gs-service-price"><span>Per unit</span><strong>{formatBillMoney(service.UnitPrice)}</strong></div><span className="gs-select-label">{checked ? "Selected for your stay" : "Select service"}<span aria-hidden="true">{checked ? "✓" : "→"}</span></span></div>
                      </label>;
                    })}</fieldset>}
                  {visible.some((service) => serviceImage(service.ServiceName)) && <p className="gs-photo-note">Photography is illustrative. Refer to each service description for details.</p>}
                </>}
            </section>
            <aside className="gs-review-column"><section className="gs-review" id="gs-review-panel" ref={reviewPanel} tabIndex="-1" aria-labelledby="gs-review-heading"><p className="gs-eyebrow">02 / REVIEW YOUR REQUEST</p><h2 id="gs-review-heading">A little extra.</h2><p className="gs-review-intro">One service at a time, added to your stay.</p>
              {selected ? <div className="gs-selected-summary"><span className="gs-small-label">YOUR SELECTION</span><h3>{selected.ServiceName}</h3><p>{formatBillMoney(selected.UnitPrice)} per unit</p></div> : <div className="gs-selection-empty"><ServiceIcon /><p>Choose a service to see your request summary.</p></div>}
              <label className="gs-quantity-label" htmlFor="gs-quantity">Quantity</label><input id="gs-quantity" type="number" min="1" max="2147483647" step="1" inputMode="numeric" value={quantity} disabled={blocked || !selected} onChange={(event) => { setQuantity(event.target.value); setConfirmed(false); setActionError(""); setNotice(""); }} aria-describedby="gs-quantity-help" required /><p id="gs-quantity-help" className="gs-field-help">Enter a whole number of units.</p>
              {selected && estimatedTotal === null && <p className="gs-error" role="alert">Enter a valid whole quantity within the service charge limit.</p>}
              <div className="gs-estimate" aria-live="polite"><span>Estimated added charge</span><strong>{estimatedTotal === null ? "—" : formatBillMoney(estimatedTotal)}</strong></div><p className="gs-price-note">The hotel's current price is saved when you submit, and may differ from this estimate.</p>
              <label className="gs-confirmation"><input type="checkbox" checked={confirmed} disabled={blocked || !selected || estimatedTotal === null} onChange={(event) => setConfirmed(event.target.checked)} /><span>I understand this request adds a service charge to my bill immediately.</span></label><p className="gs-charge-note" id="gs-charge-note">The charge is recorded immediately. For timing or special arrangements, speak with reception. No payment is taken here.</p>
              <button className="gs-button gs-submit" type="submit" disabled={blocked || !selected || !confirmed || estimatedTotal === null} aria-describedby="gs-charge-note">{pending ? "Saving your request…" : "Request & add to bill"}<span aria-hidden="true">→</span></button>
            </section><section className="gs-current-bill" aria-labelledby="gs-current-bill-heading"><p className="gs-small-label">BILL #{data.bill.BillID}</p><h3 id="gs-current-bill-heading">Your stay so far</h3><dl><div><dt>Saved service charges</dt><dd>{formatBillMoney(data.serviceCharges)}</dd></div><div><dt>Outstanding balance</dt><dd>{formatBillMoney(data.outstandingBalance)}</dd></div></dl><Link to={`/guest/bookings/${bookingId}/bill`}>View full bill <span aria-hidden="true">→</span></Link></section></aside>
          </form>}
          <section className="gs-history" aria-labelledby="gs-history-heading"><header className="gs-section-heading"><div><p className="gs-eyebrow">RECORDED ON YOUR STAY</p><h2 id="gs-history-heading">Your service history</h2></div><span>{data.serviceUsage.length} {data.serviceUsage.length === 1 ? "entry" : "entries"}</span></header><p className="gs-history-copy">These are saved charges, including services entered by hotel staff. Each entry keeps the unit price recorded at the time.</p>
            {data.serviceUsage.length ? <><ul className="gs-history-list">{data.serviceUsage.map((usage) => <li key={usage.UsageID}><div className="gs-history-icon"><ServiceIcon name={usage.ServiceName} /></div><div className="gs-history-name"><h3>{usage.ServiceName}</h3><span>Entry #{usage.UsageID}</span></div><RecordedDate value={usage.UsageDateDisplay} /><div className="gs-history-calculation"><span>{usage.Quantity} × {formatBillMoney(usage.PriceAtUsage)}</span><strong>{formatBillMoney(usage.LineTotal)}</strong></div></li>)}</ul><div className="gs-history-total"><span>Total recorded service charges</span><strong>{formatBillMoney(data.serviceCharges)}</strong></div></> : <div className="gs-empty gs-history-empty"><ServiceIcon /><div><h3>Your history starts here</h3><p>No services have been recorded for this booking.</p></div></div>}
          </section><footer className="gs-footer-note"><p>Questions about a service? Speak with reception and quote booking #{bookingId}.</p><Link to={`/guest/bookings/${bookingId}/bill`}>Bill &amp; stay history <span aria-hidden="true">→</span></Link></footer>
        </>}
    {showSelectionBar && <aside className="gs-mobile-selection" aria-label="Selected service"><div><strong>{selected.ServiceName}</strong><span>{estimatedTotal === null ? "Check quantity" : `${formatBillMoney(estimatedTotal)} estimated`}</span></div><a className="gs-button" href="#gs-review-panel" onClick={(event) => { event.preventDefault(); reviewPanel.current?.focus({ preventScroll: true }); reviewPanel.current?.scrollIntoView({ behavior: "auto", block: "start" }); }}>Review request <span aria-hidden="true">↑</span></a></aside>}
  </section>;
}
