import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { isCurrentStaff } from "../services/staffBookingApi";
import { canManageServices, clearManagedServiceAttempt, loadManagedServices, parseServiceDraft, readManagedServiceAttempt, saveManagedService } from "../services/serviceManagementApi";
import "./ManagerServices.css";

const emptyDraft = { serviceName: "", description: "", unitPrice: "", isActive: true };
const money = new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR", currencyDisplay: "code" });
const price = (value) => money.format(Number(value));
const sortServices = (rows) => [...rows].sort((a, b) => a.ServiceName.localeCompare(b.ServiceName, "en-LK") || a.ServiceID - b.ServiceID);

export default function ManagerServices({ session }) {
  const token = session?.token;
  const staffId = session?.staff?.staffId;
  const permitted = canManageServices(session?.staff?.role) && isCurrentStaff(token);
  const [initialAttempt] = useState(() => {
    if (!permitted) return { entry: null, error: "" };
    try { return { entry: readManagedServiceAttempt(staffId), error: "" }; }
    catch (error) { return { entry: { stage: "unverified" }, error: error.message }; }
  });
  const [result, setResult] = useState({ loading: true, loaded: false, rows: [], error: "" });
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [original, setOriginal] = useState(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [review, setReview] = useState(null);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState(initialAttempt.error);
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(initialAttempt.entry);
  const [reloadedForReview, setReloadedForReview] = useState(false);
  const [historyChecked, setHistoryChecked] = useState(false);
  const readController = useRef(null);
  const actionController = useRef(null);
  const mounted = useRef(false);
  const busy = useRef(false);
  const formHeading = useRef(null);
  const reviewHeading = useRef(null);
  const editable = permitted && result.loaded && !result.loading && !result.error && !pending && !attempt;

  function resetEditor() {
    setOriginal(null);
    setDraft(emptyDraft);
    setReview(null);
  }

  async function reloadCatalogue() {
    if (!permitted || busy.current) return;
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    resetEditor();
    setReloadedForReview(false);
    setHistoryChecked(false);
    setResult((previous) => ({ ...previous, loading: true, error: "" }));
    try {
      const rows = await loadManagedServices(token, controller.signal);
      if (!mounted.current || controller.signal.aborted || !isCurrentStaff(token)) return;
      setResult({ loading: false, loaded: true, rows: sortServices(rows), error: "" });
      setReloadedForReview(true);
    } catch (error) {
      if (!mounted.current || controller.signal.aborted || !isCurrentStaff(token) || error.name === "AbortError") return;
      setResult((previous) => ({ ...previous, loading: false, error: error.message }));
    }
  }

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    readController.current = controller;
    if (permitted) {
      loadManagedServices(token, controller.signal).then((rows) => {
        if (!mounted.current || controller.signal.aborted || !isCurrentStaff(token)) return;
        setResult({ loading: false, loaded: true, rows: sortServices(rows), error: "" });
      }).catch((error) => {
        if (!mounted.current || controller.signal.aborted || !isCurrentStaff(token) || error.name === "AbortError") return;
        setResult((previous) => ({ ...previous, loading: false, error: error.message }));
      });
    }
    return () => {
      mounted.current = false;
      readController.current?.abort();
      actionController.current?.abort();
    };
  }, [token, permitted]);

  useEffect(() => { if (review) reviewHeading.current?.focus(); }, [review]);

  function selectService(row) {
    if (!editable || busy.current) return;
    setOriginal(row);
    setDraft({ serviceName: row.ServiceName, description: row.Description ?? "", unitPrice: row.UnitPrice, isActive: row.IsActive });
    setReview(null);
    setActionError("");
    setNotice("");
    formHeading.current?.focus();
    formHeading.current?.scrollIntoView({ block: "start" });
  }

  function changeDraft(field, value) {
    if (!editable || busy.current) return;
    setDraft((previous) => ({ ...previous, [field]: value }));
    setReview(null);
    setActionError("");
  }

  function reviewChanges(event) {
    event.preventDefault();
    if (!editable || busy.current) return;
    try {
      const normalized = parseServiceDraft(draft);
      const next = { ...normalized, isActive: original ? draft.isActive : true };
      if (original && next.serviceName === original.ServiceName && next.description === original.Description && next.unitPrice === original.UnitPrice && next.isActive === original.IsActive) {
        setActionError("There are no changes to save.");
        return;
      }
      setReview({ ...next, serviceId: original?.ServiceID ?? null, ...(original ? { expected: original } : {}) });
      setActionError("");
      setNotice("");
    } catch (error) { setActionError(error.message); }
  }

  function retainAttempt(fallback) {
    try {
      const stored = readManagedServiceAttempt(staffId);
      setAttempt(fallback.stage === "saved" ? { ...stored, ...fallback } : stored || fallback);
    }
    catch { setAttempt(fallback); }
    setReloadedForReview(false);
    setHistoryChecked(false);
  }

  function acknowledgeSave(saved) {
    const row = saved.service;
    setResult((previous) => ({ ...previous, rows: sortServices([...previous.rows.filter((item) => item.ServiceID !== row.ServiceID), row]) }));
    resetEditor();
    setNotice(`${row.ServiceName} was saved successfully. ${row.IsActive ? "It is active in the service catalogue." : "It is retired and hidden from the guest and staff catalogue."}`);
    setActionError("");
    try {
      clearManagedServiceAttempt(staffId);
      setAttempt(null);
    } catch (error) {
      retainAttempt({ stage: "saved", serviceId: row.ServiceID, serviceName: row.ServiceName, unitPrice: row.UnitPrice });
      setActionError(error.message);
    }
  }

  async function confirmSave() {
    if (!review || !editable || busy.current || !isCurrentStaff(token)) return;
    busy.current = true;
    setPending(true);
    setActionError("");
    const controller = new AbortController();
    actionController.current = controller;
    try {
      const saved = await saveManagedService(review, token, controller.signal);
      if (!mounted.current || controller.signal.aborted || !isCurrentStaff(token)) return;
      acknowledgeSave(saved);
    } catch (error) {
      if (!mounted.current || controller.signal.aborted || !isCurrentStaff(token) || error.name === "AbortError") return;
      setReview(null);
      setActionError(error.message);
      if (error.outcomeUnknown) {
        retainAttempt({ stage: "pending", serviceId: review.serviceId, serviceName: review.serviceName, unitPrice: review.unitPrice });
      } else {
        try { setAttempt(readManagedServiceAttempt(staffId)); }
        catch { retainAttempt({ stage: "unverified" }); }
      }
      if (error.status === 409) setResult((previous) => ({ ...previous, error: "The catalogue changed while you were editing. Reload it and review the latest service before making another change." }));
    } finally {
      busy.current = false;
      if (mounted.current && isCurrentStaff(token)) setPending(false);
    }
  }

  function finishInspection() {
    if (!permitted || pending || busy.current || !attempt || !reloadedForReview || !historyChecked || result.loading || result.error || !isCurrentStaff(token)) return;
    try {
      clearManagedServiceAttempt(staffId);
      setAttempt(null);
      setActionError("");
      setReloadedForReview(false);
      setHistoryChecked(false);
      resetEditor();
      setNotice("Catalogue inspection acknowledged. Choose an existing service or start a new entry. The previous request has not been sent again.");
    } catch (error) { setActionError(error.message); }
  }

  if (!permitted) return <section className="manager-services-page" aria-labelledby="manager-services-heading">
    <div className="ms-access"><p className="ms-eyebrow">STAFF WORKSPACE</p><h1 id="manager-services-heading">Service catalogue</h1><p role="alert">Manager or administrator access is required to manage services.</p><Link className="ms-button" to="/staff">Return to staff account</Link></div>
  </section>;

  const activeCount = result.rows.filter((row) => row.IsActive).length;
  const matching = result.rows.filter((row) => (statusFilter === "all" || row.IsActive === (statusFilter === "active")) && `${row.ServiceName} ${row.Description ?? ""} ${row.ServiceID}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const retirement = review && original?.IsActive && !review.isActive;
  const reactivation = review && original && !original.IsActive && review.isActive;

  return <section className="manager-services-page" aria-labelledby="manager-services-heading">
    <nav className="ms-navigation" aria-label="Staff workspace"><Link to="/staff/dashboard">Dashboard</Link><span aria-hidden="true">/</span><Link to="/staff/reports">Reports</Link><span aria-hidden="true">/</span><Link to="/staff">Staff account</Link></nav>
    <header className="ms-heading"><div><p className="ms-eyebrow">MANAGEMENT / GUEST SERVICES</p><h1 id="manager-services-heading">Service catalogue</h1><p className="ms-intro">Thoughtful extras, clearly priced. Maintain your services and choose what guests can request.</p></div><div className="ms-heading-note"><span>THE SERVICE COLLECTION</span><p>One shared catalogue<br />across all hotel branches.</p></div></header>

    <div className="ms-principles"><span className="ms-principles-mark" aria-hidden="true">i</span><div><strong>Current prices. Preserved charges.</strong><p>Price changes apply to future service usage. Existing usage entries keep their saved prices and charges. Retired services are hidden from the catalogue and keep their history. Requests already being processed may still finish.</p></div></div>

    {notice && <div className="ms-notice" role="status">{notice}</div>}
    {actionError && <div className="ms-error" role="alert">{actionError}</div>}
    {attempt && <section className="ms-recovery" aria-labelledby="service-inspection-heading"><p className="ms-eyebrow">CHECK BEFORE CONTINUING</p><h2 id="service-inspection-heading">{attempt.stage === "saved" ? "Your previous change was saved" : "Check the previous save result"}</h2><p>{attempt.stage === "saved" ? "A save was confirmed, but its completion notice still needs to be cleared." : "A previous request may already have changed the catalogue. Further saves are paused so that it is not sent twice."} Wait until any save already in progress has finished. Then reload the catalogue and inspect the service and its price before continuing. If the result is still uncertain, contact your administrator before saving it again.</p>{attempt.serviceName && <p className="ms-attempt-detail"><strong>{attempt.serviceName}</strong>{attempt.serviceId ? ` · Service #${attempt.serviceId}` : " · New service"}{attempt.unitPrice ? ` · ${price(attempt.unitPrice)}` : ""}</p>}<button type="button" className="ms-button ms-button--outline" disabled={result.loading || pending} onClick={() => void reloadCatalogue()}>{result.loading ? "Loading catalogue…" : "Reload catalogue for inspection"}</button><label className="ms-checkbox"><input type="checkbox" checked={historyChecked} disabled={!reloadedForReview || result.loading || Boolean(result.error) || pending} onChange={(event) => setHistoryChecked(event.target.checked)} /><span>I have inspected the reloaded catalogue and understand the previous request will not be submitted again.</span></label><button className="ms-button" type="button" disabled={!reloadedForReview || !historyChecked || result.loading || Boolean(result.error) || pending} onClick={finishInspection}>Finish inspection</button></section>}

    <section className="ms-catalogue" aria-labelledby="manager-catalogue-heading">
      <div className="ms-section-heading"><div><p className="ms-eyebrow">THE CURRENT COLLECTION</p><h2 id="manager-catalogue-heading">Service catalogue</h2></div><button type="button" className="ms-button ms-button--outline" onClick={() => void reloadCatalogue()} disabled={result.loading || pending}>{result.loading ? "Loading…" : "Reload catalogue"}<span aria-hidden="true">↻</span></button></div>
      <div className="ms-toolbar"><div className="ms-field ms-search"><label htmlFor="manager-service-search">Find a service</label><input type="search" id="manager-service-search" value={search} placeholder="Search by name, description or reference" onChange={(event) => setSearch(event.target.value)} /></div><div className="ms-field"><label htmlFor="manager-service-filter">Show services</label><select id="manager-service-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Active and retired</option><option value="active">Active only</option><option value="retired">Retired only</option></select></div></div>
      {result.loaded && !result.loading && !result.error && <div className="ms-counts" aria-live="polite"><span><strong>{matching.length}</strong> shown</span><span><strong>{activeCount}</strong> active</span><span><strong>{result.rows.length - activeCount}</strong> retired</span><p>Reloading clears any unfinished edits.</p></div>}
      <div aria-busy={result.loading}>
        {result.loading ? <div className="ms-state" role="status"><h3>Loading your catalogue…</h3><p>Retrieving active and retired services.</p></div> : result.error ? <div className="ms-state ms-state--error"><h3>The catalogue needs a fresh read</h3><p role="alert">{result.error}</p><button type="button" className="ms-button" onClick={() => void reloadCatalogue()} disabled={pending}>Reload catalogue</button></div> : !matching.length ? <div className="ms-state"><h3>{result.rows.length ? "No services match this view" : "Start your service collection"}</h3><p>{result.rows.length ? "Try a different search or include retired services." : "Add the first service using the form below."}</p>{result.rows.length > 0 && <button type="button" className="ms-button ms-button--outline" onClick={() => { setSearch(""); setStatusFilter("all"); }}>Show all services</button>}</div> : <div className="ms-cards">{matching.map((row) => <article key={row.ServiceID} className={`ms-card${row.IsActive ? "" : " ms-card--retired"}${original?.ServiceID === row.ServiceID ? " ms-card--selected" : ""}`}><div className="ms-card-top"><span className="ms-reference">SERVICE / {String(row.ServiceID).padStart(2, "0")}</span><span className={`ms-status${row.IsActive ? "" : " ms-status--retired"}`}>{row.IsActive ? "Active" : "Retired"}</span></div><h3>{row.ServiceName}</h3><p className="ms-card-description">{row.Description || "No description added."}</p><div className="ms-card-bottom"><div><span>PRICE PER UNIT</span><strong>{price(row.UnitPrice)}</strong></div><button className="ms-edit" type="button" disabled={!editable} onClick={() => selectService(row)} aria-label={`Edit ${row.ServiceName}`}>Edit service <span aria-hidden="true">↗</span></button></div></article>)}</div>}
      </div>
    </section>

    <section className="ms-editor" aria-labelledby="manager-service-form-heading">
      <aside className="ms-editor-intro"><p className="ms-eyebrow">{original ? `SERVICE / ${String(original.ServiceID).padStart(2, "0")}` : "GROW YOUR COLLECTION"}</p><h2 id="manager-service-form-heading" ref={formHeading} tabIndex={-1}>{original ? "Refine this service" : "Add a new service"}</h2><p>{original ? "Update the details, then review exactly what will change before saving." : "Give guests a clear description and a transparent price. New services are available immediately after saving."}</p><div className="ms-editor-note"><strong>A note on names</strong><p>Renaming a service also changes its label in previous service history. Use a new service entry when introducing a different offering.</p></div>{original && <button className="ms-button ms-button--outline" type="button" disabled={pending} onClick={() => { resetEditor(); setActionError(""); }}>Cancel edit / add new</button>}</aside>
      <div className="ms-editor-content"><form className="ms-form" onSubmit={reviewChanges}><fieldset disabled={!editable || Boolean(review)}><legend className="ms-sr-only">{original ? "Edit service details" : "New service details"}</legend><div className="ms-field"><label htmlFor="manager-service-name">Service name</label><input id="manager-service-name" type="text" maxLength={100} required value={draft.serviceName} onChange={(event) => changeDraft("serviceName", event.target.value)} placeholder="For example, evening room service" /></div><div className="ms-field"><label htmlFor="manager-service-description">Description <span>(optional)</span></label><input id="manager-service-description" type="text" maxLength={255} value={draft.description} onChange={(event) => changeDraft("description", event.target.value)} placeholder="Explain what is included for the guest." aria-describedby="manager-service-description-hint" /><span className="ms-field-hint" id="manager-service-description-hint">One line, up to 255 characters.</span></div><div className="ms-field"><label htmlFor="manager-service-price">Price per unit (LKR)</label><input id="manager-service-price" type="text" inputMode="decimal" maxLength={11} required value={draft.unitPrice} onChange={(event) => changeDraft("unitPrice", event.target.value)} placeholder="0.00" aria-describedby="manager-service-price-hint" /><span className="ms-field-hint" id="manager-service-price-hint">Use up to two decimal places. Enter 0 for a complimentary service.</span></div>{original && <label className="ms-checkbox ms-availability"><input type="checkbox" checked={draft.isActive} onChange={(event) => changeDraft("isActive", event.target.checked)} /><span><strong>Available for new requests</strong><span>{draft.isActive ? "This service will be active in the guest and staff catalogue." : "This service will be retired. Existing service entries and charges remain."}</span></span></label>}<button className="ms-button" type="submit">{original ? "Review changes" : "Review new service"}<span aria-hidden="true">→</span></button></fieldset></form>
      {!editable && !pending && !review && <p className="ms-form-paused">{attempt ? "Complete the catalogue inspection above to enable changes." : "Load the latest catalogue to enable this form."}</p>}
      {review && <section className="ms-review" aria-labelledby="manager-service-review-heading"><p className="ms-eyebrow">REVIEW BEFORE SAVING</p><h3 id="manager-service-review-heading" ref={reviewHeading} tabIndex={-1}>{retirement ? "Retire this service?" : reactivation ? "Make this service available?" : original ? "Confirm these changes" : "Ready to add this service?"}</h3><dl><div><dt>Service name</dt><dd>{review.serviceName}</dd></div><div><dt>Description</dt><dd>{review.description || "No description"}</dd></div><div><dt>Price per unit</dt><dd>{original && original.UnitPrice !== review.unitPrice && <span className="ms-previous-price">Previously {price(original.UnitPrice)}</span>}<strong>{price(review.unitPrice)}</strong></dd></div><div><dt>Availability</dt><dd>{review.isActive ? "Active — accepts new requests" : "Retired — hidden from the catalogue"}</dd></div></dl>{original?.ServiceName !== review.serviceName && original && <p className="ms-review-note">The name will change from “{original.ServiceName}” to “{review.serviceName}”, including its label in previous history.</p>}{original && <p className="ms-review-note">Saved usage prices and charges stay unchanged.{retirement ? " It will be hidden from the catalogue. Requests already being processed may still finish." : " The current price will apply to future usage."}</p>}<div className="ms-review-actions"><button type="button" className="ms-button" disabled={!editable || pending} onClick={() => void confirmSave()}>{pending ? "Saving service…" : retirement ? "Confirm retirement" : reactivation ? "Confirm reactivation" : original ? "Save changes" : "Add service"}</button><button className="ms-button ms-button--outline" type="button" disabled={pending} onClick={() => setReview(null)}>Back to edit</button></div></section>}
      </div>
    </section>
    <footer className="ms-footer-note"><span aria-hidden="true">↗</span><p>Want to see what guests can request? <Link to="/services">Open the public service catalogue</Link>.</p></footer>
  </section>;
}
