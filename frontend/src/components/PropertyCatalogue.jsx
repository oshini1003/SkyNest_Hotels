import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { isCurrentStaff } from "../services/staffBookingApi";
import {
  canManageProperty, clearPropertyAttempt, createPropertyItem,
  loadPropertyCatalogue, parseBranchDraft, parseRoomTypeDraft, propertyAttemptMatchesCatalogue, readPropertyAttempt,
} from "../services/propertyManagementApi";
import "./PropertyCatalogue.css";

const emptyBranch = () => ({ name: "", location: "", contactNumber: "" });
const emptyRoomType = () => ({ name: "", capacity: "", dailyRate: "", amenityIds: [] });
const formatMoney = (value) => {
  const [whole, fraction = "00"] = String(value).split(".");
  return `LKR ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction.padEnd(2, "0")}`;
};
const sortByName = (rows) => [...rows].sort((a, b) => a.Name.localeCompare(b.Name, "en-LK"));


function PropertyMark({ rooms = false }) {
  return <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
    {rooms ? <><path d="M5 25V10M27 25V16H5M9 16v-5h8v5m0-4h6a4 4 0 0 1 4 4M5 22h22" /></> : <><path d="M6 27V7l10-3 10 3v20M3 27h26M13 27v-7h6v7M11 10h2m6 0h2m-10 5h2m6 0h2" /></>}
  </svg>;
}

// A fresh staff session gets its own form, read requests and recovery state.
export default function PropertyCatalogue({ kind, session }) {
  return <PropertyCatalogueSession key={`${kind}:${session?.staff?.staffId}:${session?.token}`} kind={kind} session={session} />;
}

function PropertyCatalogueSession({ kind, session }) {
  const isBranch = kind === "branches";
  const singular = isBranch ? "branch" : "room type";
  const plural = isBranch ? "branches" : "room types";
  const title = isBranch ? "Our hotel branches" : "Room types & comforts";
  const token = session?.token;
  const staffId = session?.staff?.staffId;
  const permitted = canManageProperty(session?.staff?.role) && isCurrentStaff(token);
  const [initialAttempt] = useState(() => {
    if (!permitted) return { entry: null, error: "" };
    try { return { entry: readPropertyAttempt(kind, staffId), error: "" }; }
    catch (error) { return { entry: { stage: "unverified" }, error: error.message }; }
  });
  const [result, setResult] = useState({ loading: true, loaded: false, rows: [], amenities: [], error: "" });
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [draft, setDraft] = useState(isBranch ? emptyBranch : emptyRoomType);
  const [review, setReview] = useState(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState(initialAttempt.error);
  const [attempt, setAttempt] = useState(initialAttempt.entry);
  const [inspectedRead, setInspectedRead] = useState(false);
  const [checked, setChecked] = useState(false);
  const readController = useRef(null);
  const actionController = useRef(null);
  const readVersion = useRef(0);
  const mounted = useRef(false);
  const saving = useRef(false);
  const formHeading = useRef(null);
  const reviewHeading = useRef(null);
  const editable = permitted && result.loaded && !result.loading && !result.error && !pending && !attempt;

  async function reloadCatalogue(inspection = false, confirmed = null) {
    if (!permitted || saving.current || !isCurrentStaff(token)) return;
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    const version = ++readVersion.current;
    setReview(null);
    setInspectedRead(false);
    setChecked(false);
    setResult((previous) => ({ ...previous, loading: true, error: "" }));
    try {
      const data = await loadPropertyCatalogue(kind, token, controller.signal);
      if (!mounted.current || version !== readVersion.current || controller.signal.aborted || !isCurrentStaff(token)) return;
      setResult({ loading: false, loaded: true, rows: sortByName(data.rows), amenities: data.amenities, error: "" });
      setInspectedRead(inspection || Boolean(confirmed));
      if (confirmed) {
        const matches = propertyAttemptMatchesCatalogue({ kind, stage: "saved", id: confirmed.id, draft: confirmed }, data);
        if (matches) {
          try {
            clearPropertyAttempt(kind, staffId);
            setAttempt(null);
            setActionError("");
            setInspectedRead(false);
          } catch (error) { setActionError(error.message); }
        } else {
          setActionError("The addition was confirmed, but the refreshed details need checking. Inspect the catalogue before adding another entry.");
        }
      }
      if (!isBranch) {
        const available = new Set(data.amenities.map((item) => item.AmenityID));
        setDraft((previous) => ({ ...previous, amenityIds: previous.amenityIds.filter((id) => available.has(id)) }));
      }
    } catch (error) {
      if (!mounted.current || version !== readVersion.current || controller.signal.aborted || !isCurrentStaff(token) || error.name === "AbortError") return;
      setResult((previous) => ({ ...previous, loading: false, error: error.message }));
    }
  }

  useEffect(() => {
    mounted.current = true;
    void reloadCatalogue();
    return () => {
      mounted.current = false;
      // Invalidate the latest request generation, including requests started after mount.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ++readVersion.current;
      readController.current?.abort();
      // Abort the latest action, which may have started after this effect mounted.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      actionController.current?.abort();
    };
    // Session and catalogue changes remount this component using its key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (review) reviewHeading.current?.focus(); }, [review]);

  function updateDraft(field, value) {
    if (!editable || saving.current) return;
    setDraft((previous) => ({ ...previous, [field]: value }));
    setReview(null);
    setActionError("");
  }

  function toggleAmenity(id) {
    updateDraft("amenityIds", draft.amenityIds.includes(id)
      ? draft.amenityIds.filter((value) => value !== id) : [...draft.amenityIds, id]);
  }

  function reviewDraft(event) {
    event.preventDefault();
    if (!editable || saving.current) return;
    try {
      const normalized = isBranch ? parseBranchDraft(draft) : parseRoomTypeDraft(draft);
      if (!isBranch && normalized.amenityIds.some((id) => !result.amenities.some((row) => row.AmenityID === id))) {
        throw new Error("An amenity is no longer listed. Reload the catalogue and review your selection.");
      }
      setReview(normalized);
      setActionError("");
    } catch (error) { setActionError(error.message); }
  }

  function retainAttempt(fallback) {
    try {
      const stored = readPropertyAttempt(kind, staffId);
      setAttempt(fallback.stage === "saved" ? { ...stored, ...fallback } : stored || fallback);
    } catch { setAttempt(fallback); }
    setInspectedRead(false);
    setChecked(false);
  }

  async function confirmCreate() {
    if (!review || !editable || saving.current || !isCurrentStaff(token)) return;
    saving.current = true;
    setPending(true);
    setActionError("");
    setInspectedRead(false);
    setChecked(false);
    const submitted = review;
    const controller = new AbortController();
    actionController.current = controller;
    let confirmed = null;
    try {
      const saved = await createPropertyItem(kind, submitted, token, controller.signal);
      if (!mounted.current || controller.signal.aborted || !isCurrentStaff(token)) return;
      setNotice(`${saved.name} was added successfully. ${isBranch ? "Branch" : "Room type"} reference: #${saved.id}.`);
      setDraft(isBranch ? emptyBranch() : emptyRoomType());
      setReview(null);
      retainAttempt({ kind, staffId, stage: "saved", id: saved.id, draft: submitted });
      if (saved.storageNotice) setActionError(saved.storageNotice);
      confirmed = saved;
    } catch (error) {
      if (!mounted.current || controller.signal.aborted || !isCurrentStaff(token) || error.name === "AbortError") return;
      setReview(null);
      setActionError(error.message);
      try { setAttempt(readPropertyAttempt(kind, staffId)); }
      catch { retainAttempt({ kind, staffId, stage: "unverified", draft: submitted }); }
      if (error.outcomeUnknown) retainAttempt({ kind, staffId, stage: "pending", id: null, draft: submitted });
      if ([401, 403].includes(error.status)) {
        setResult((previous) => ({ ...previous, error: "Your access could not be confirmed. Sign in again or reload the catalogue before continuing." }));
      }
    } finally {
      saving.current = false;
      if (mounted.current && isCurrentStaff(token)) setPending(false);
    }
    if (confirmed && mounted.current && isCurrentStaff(token)) await reloadCatalogue(false, confirmed);
  }

  function finishInspection() {
    if (!permitted || saving.current || pending || !attempt || !inspectedRead || !checked || result.loading || result.error || !isCurrentStaff(token)) return;
    try {
      clearPropertyAttempt(kind, staffId);
      setAttempt(null);
      setActionError("");
      setReview(null);
      setDraft(isBranch ? emptyBranch() : emptyRoomType());
      setChecked(false);
      setInspectedRead(false);
      setNotice("Catalogue inspection completed. The previous request has not been sent again.");
    } catch (error) { setActionError(error.message); }
  }

  if (!permitted) return <section className="property-page" aria-labelledby="property-heading">
    <div className="pc-access"><p className="pc-eyebrow">PROPERTY MANAGEMENT</p><h1 id="property-heading">{title}</h1><p role="alert">Sign in as a manager or administrator to manage hotel properties.</p><Link className="pc-button" to="/staff">Return to staff account</Link></div>
  </section>;

  const query = search.trim().toLocaleLowerCase();
  const matching = result.rows.filter((row) => {
    const text = isBranch ? `${row.Name} ${row.Location} ${row.ContactNumber} ${row.BranchID}` : `${row.Name} ${row.RoomTypeID} ${row.amenities.join(" ")}`;
    const matchesFilter = !filter || (isBranch ? row.Location === filter : row.Capacity >= Number(filter));
    return matchesFilter && text.toLocaleLowerCase().includes(query);
  });
  const locations = isBranch ? [...new Set(result.rows.map((row) => row.Location))].sort((a, b) => a.localeCompare(b)) : [];
  const amenitiesFor = (value) => result.amenities.filter((row) => value.amenityIds?.includes(row.AmenityID)).map((row) => row.AmenityName);
  const addLabel = `Add ${singular}`;

  return <section className="property-page" aria-labelledby="property-heading">
    <nav className="pc-breadcrumb" aria-label="Staff workspace"><Link to="/staff/dashboard">Dashboard</Link><span aria-hidden="true">/</span><Link to="/staff">Staff account</Link><span aria-hidden="true">/</span><span>Property management</span></nav>
    <header className="pc-heading"><div><p className="pc-eyebrow">SKYNEST / PROPERTY COLLECTION</p><h1 id="property-heading">{title}</h1><p className="pc-intro">{isBranch ? "A considered welcome, in every destination. Keep your hotel locations and their contact details together." : "Set the foundations of a comfortable stay. Explore room categories, guest capacity and the comforts included."}</p></div><a className="pc-button" href="#property-add" onClick={() => formHeading.current?.focus()}>{addLabel}<span aria-hidden="true">+</span></a></header>
    <nav className="pc-tabs" aria-label="Property catalogues"><Link to="/staff/branches" aria-current={isBranch ? "page" : undefined}>Branches</Link><Link to="/staff/room-types" aria-current={!isBranch ? "page" : undefined}>Room types</Link></nav>

    {notice && <div className="pc-notice" role="status">{notice}</div>}
    {actionError && <div className="pc-error" role="alert">{actionError}</div>}
    {attempt && <section className="pc-recovery" aria-labelledby="property-recovery-heading"><p className="pc-eyebrow">CHECK BEFORE CONTINUING</p><h2 id="property-recovery-heading">{attempt.stage === "saved" ? `Your ${singular} was added` : "Check the previous save result"}</h2><p>{attempt.stage === "saved" ? "The save was confirmed, but its completion record still needs to be cleared." : `A previous request may already have added a ${singular}. Further additions are paused to help prevent a duplicate.`} Wait until any save in progress has finished. Reload the catalogue and inspect the details below. If the result is uncertain, contact your administrator before adding it again.</p>{attempt.draft && <dl className="pc-attempt-details"><div><dt>Name</dt><dd>{attempt.draft.name}</dd></div>{isBranch ? <><div><dt>Location</dt><dd>{attempt.draft.location}</dd></div><div><dt>Contact number</dt><dd>{attempt.draft.contactNumber}</dd></div></> : <><div><dt>Capacity</dt><dd>{attempt.draft.capacity} guest(s)</dd></div><div><dt>Nightly rate</dt><dd>{formatMoney(attempt.draft.dailyRate)}</dd></div><div><dt>Selected amenities</dt><dd>{attempt.draft.amenityIds.length ? attempt.draft.amenityIds.map((id) => result.amenities.find((item) => item.AmenityID === id)?.AmenityName || `Amenity #${id}`).join(", ") : "No amenities selected"}</dd></div></>}{attempt.id && <div><dt>Reference</dt><dd>#{attempt.id}</dd></div>}</dl>}<button type="button" className="pc-button pc-button--outline" disabled={result.loading || pending} onClick={() => void reloadCatalogue(true)}>{result.loading ? "Loading catalogue…" : "Reload to inspect"}</button><label className="pc-check"><input type="checkbox" checked={checked} disabled={!inspectedRead || result.loading || Boolean(result.error) || pending} onChange={(event) => setChecked(event.target.checked)} /><span>I have checked the reloaded catalogue and resolved the outcome of the previous request.</span></label><button type="button" className="pc-button" disabled={!checked || !inspectedRead || result.loading || Boolean(result.error) || pending} onClick={finishInspection}>Finish inspection</button></section>}

    <section className="pc-collection" aria-labelledby="property-list-heading">
      <div className="pc-section-heading"><div><p className="pc-eyebrow">{isBranch ? "OUR DESTINATIONS" : "THE ROOM COLLECTION"}</p><h2 id="property-list-heading">{isBranch ? "Every place to stay" : "A room for every stay"}</h2></div><button className="pc-text-button" type="button" disabled={result.loading || pending} onClick={() => void reloadCatalogue()}>{result.loading ? "Loading…" : "Refresh catalogue"}<span aria-hidden="true">↻</span></button></div>
      <div className="pc-toolbar"><div className="pc-field"><label htmlFor="property-search">{isBranch ? "Find a branch" : "Find a room type"}</label><input id="property-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={isBranch ? "Search name, location or reference" : "Search name, amenity or reference"} /></div><div className="pc-field"><label htmlFor="property-filter">{isBranch ? "Location" : "Guest capacity"}</label><select id="property-filter" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="">{isBranch ? "All locations" : "Any capacity"}</option>{isBranch ? locations.map((location) => <option key={location} value={location}>{location}</option>) : [1, 2, 3, 4, 5, 6].map((capacity) => <option key={capacity} value={capacity}>{capacity}+ {capacity === 1 ? "guest" : "guests"}</option>)}</select></div></div>
      {result.loaded && !result.loading && !result.error && <p className="pc-count" aria-live="polite"><strong>{matching.length}</strong> of {result.rows.length} {plural}{(search || filter) && <button className="pc-text-button" type="button" onClick={() => { setSearch(""); setFilter(""); }}>Clear filters</button>}</p>}
      <div aria-busy={result.loading}>
        {result.loading ? <div className="pc-state" role="status"><span className="pc-state-mark"><PropertyMark rooms={!isBranch} /></span><h3>Loading your {plural}…</h3><p>Retrieving the latest hotel catalogue.</p></div> : result.error ? <div className="pc-state pc-state--error"><h3>We could not refresh the catalogue</h3><p role="alert">{result.error}</p><button type="button" className="pc-button" disabled={pending} onClick={() => void reloadCatalogue()}>Try loading again</button></div> : !matching.length ? <div className="pc-state"><span className="pc-state-mark"><PropertyMark rooms={!isBranch} /></span><h3>{result.rows.length ? `No ${plural} match your search` : `Add your first ${singular}`}</h3><p>{result.rows.length ? "Try another name or clear the filters to see the full collection." : "Start with the details in the form below."}</p>{result.rows.length > 0 && <button type="button" className="pc-button pc-button--outline" onClick={() => { setSearch(""); setFilter(""); }}>Show all {plural}</button>}</div> : <div className="pc-cards">{matching.map((row) => <article className={`pc-card${isBranch ? " pc-card--branch" : ""}`} key={isBranch ? row.BranchID : row.RoomTypeID}><div className="pc-card-top"><span className="pc-card-mark"><PropertyMark rooms={!isBranch} /></span><span className="pc-reference">{isBranch ? "BRANCH" : "ROOM TYPE"} / {String(isBranch ? row.BranchID : row.RoomTypeID).padStart(2, "0")}</span></div><h3>{row.Name}</h3>{isBranch ? <dl className="pc-branch-details"><div><dt>LOCATION</dt><dd>{row.Location}</dd></div><div><dt>CONTACT NUMBER</dt><dd>{row.ContactNumber}</dd></div></dl> : <><div className="pc-room-facts"><div><span>GUEST CAPACITY</span><strong>{row.Capacity} <small>{row.Capacity === 1 ? "guest" : "guests"}</small></strong></div><div><span>PER NIGHT</span><strong className="pc-money">{formatMoney(row.DailyRate)}</strong></div></div><div className="pc-comforts"><h4>Included amenities</h4>{row.amenities.length ? <ul>{row.amenities.map((name, index) => <li key={`${name}:${index}`}>{name}</li>)}</ul> : <p>No amenities linked.</p>}</div></>}</article>)}</div>}
      </div>
    </section>

    <section className="pc-editor" id="property-add" aria-labelledby="property-form-heading"><aside className="pc-editor-intro"><span className="pc-editor-mark"><PropertyMark rooms={!isBranch} /></span><p className="pc-eyebrow">GROW THE COLLECTION</p><h2 id="property-form-heading" tabIndex={-1} ref={formHeading}>{isBranch ? "A new destination" : "A new kind of stay"}</h2><p>{isBranch ? "Add the branch name, its location and a number your team can use to reach it." : "Give the room type a clear name, set its capacity and nightly rate, then choose the amenities included."}</p><ol className="pc-steps"><li><span>01</span>Enter the details</li><li><span>02</span>Review your entry</li><li><span>03</span>Confirm and add</li></ol><p className="pc-editor-footnote">{isBranch ? "Adding a branch creates its directory entry. Rooms are added separately." : "This defines a room category. Individual rooms are added separately."}</p></aside>
      <div className="pc-editor-content"><form onSubmit={reviewDraft} className="pc-form"><fieldset disabled={!editable || Boolean(review)}><legend className="pc-sr-only">New {singular} details</legend><div className="pc-field"><label htmlFor="property-name">{isBranch ? "Branch name" : "Room type name"}</label><input id="property-name" type="text" maxLength={100} required value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} placeholder={isBranch ? "For example, SkyNest Negombo" : "For example, Deluxe Double"} /></div>
      {isBranch ? <><div className="pc-field"><label htmlFor="property-location">Location</label><input id="property-location" type="text" maxLength={150} required value={draft.location} onChange={(event) => updateDraft("location", event.target.value)} placeholder="City or hotel address" /></div><div className="pc-field"><label htmlFor="property-contact">Contact number</label><input id="property-contact" type="tel" maxLength={20} required value={draft.contactNumber} onChange={(event) => updateDraft("contactNumber", event.target.value)} placeholder="For example, +94 31 234 5678" aria-describedby="property-contact-hint" /><span id="property-contact-hint" className="pc-hint">Include the area or country code.</span></div></> : <><div className="pc-form-row"><div className="pc-field"><label htmlFor="property-capacity">Maximum guests</label><input id="property-capacity" type="text" inputMode="numeric" maxLength={3} required value={draft.capacity} onChange={(event) => updateDraft("capacity", event.target.value)} placeholder="2" /><span className="pc-hint">1–100 guests, using whole numbers.</span></div><div className="pc-field"><label htmlFor="property-rate">Nightly rate (LKR)</label><input id="property-rate" type="text" inputMode="decimal" maxLength={11} required value={draft.dailyRate} onChange={(event) => updateDraft("dailyRate", event.target.value)} placeholder="0.00" aria-describedby="property-rate-hint" /><span className="pc-hint" id="property-rate-hint">Use up to two decimal places.</span></div></div><fieldset className="pc-amenity-picker"><legend>Included amenities <span>(optional)</span></legend>{result.amenities.length ? <div className="pc-amenity-options">{result.amenities.map((amenity) => <label key={amenity.AmenityID} className="pc-check"><input type="checkbox" checked={draft.amenityIds.includes(amenity.AmenityID)} onChange={() => toggleAmenity(amenity.AmenityID)} /><span>{amenity.AmenityName}</span></label>)}</div> : <p className="pc-hint">{result.loading ? "Loading available amenities…" : "No amenities are currently listed. You can add this room type without amenities."}</p>}</fieldset></>}
      <button className="pc-button" type="submit">Review {singular}<span aria-hidden="true">→</span></button></fieldset></form>
      {!editable && !review && !pending && <p className="pc-form-paused">{attempt ? "Complete the inspection above before adding another entry." : "Load the latest catalogue to enable this form."}</p>}
      {review && <section className="pc-review" aria-labelledby="property-review-heading"><p className="pc-eyebrow">REVIEW BEFORE ADDING</p><h3 ref={reviewHeading} id="property-review-heading" tabIndex={-1}>Ready to add this {singular}?</h3><dl><div><dt>Name</dt><dd>{review.name}</dd></div>{isBranch ? <><div><dt>Location</dt><dd>{review.location}</dd></div><div><dt>Contact number</dt><dd>{review.contactNumber}</dd></div></> : <><div><dt>Maximum guests</dt><dd>{review.capacity}</dd></div><div><dt>Nightly rate</dt><dd>{formatMoney(review.dailyRate)}</dd></div><div><dt>Included amenities</dt><dd>{amenitiesFor(review).join(", ") || "No amenities selected"}</dd></div></>}</dl><div className="pc-review-actions"><button className="pc-button" type="button" disabled={!editable || pending} onClick={() => void confirmCreate()}>{pending ? `Adding ${singular}…` : `Confirm & add ${singular}`}</button><button className="pc-button pc-button--outline" type="button" disabled={pending} onClick={() => setReview(null)}>Back to details</button></div></section>}
      </div>
    </section>
    <footer className="pc-footer"><p>{isBranch ? "Explore how these destinations appear to your guests." : "Explore rooms and the comforts available for a stay."} <Link to={isBranch ? "/branches" : "/rooms"}>{isBranch ? "View hotel branches" : "Open room search"}<span aria-hidden="true"> ↗</span></Link></p></footer>
  </section>;
}
