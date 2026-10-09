import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { isCurrentStaff } from "../services/staffBookingApi";
import {
  canManageProperty, clearPropertyAttempt, createPropertyItem, loadPropertyCatalogue,
  parseAmenityDraft, parseRoomDraft, propertyAttemptMatchesCatalogue, readPropertyAttempt,
} from "../services/propertyManagementApi";
import "./PropertyCatalogue.css";
import "./PropertyInventory.css";

const emptyRoom = () => ({ branchId: "", roomTypeId: "", roomNumber: "" });
const emptyAmenity = () => ({ name: "" });
const emptyResult = () => ({ loading: true, loaded: false, rows: [], branches: [], roomTypes: [], amenities: [], error: "" });
const formatMoney = (value) => {
  const [whole, fraction = "00"] = String(value).split(".");
  return `LKR ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction.padEnd(2, "0")}`;
};
const sortNames = (rows) => [...rows].sort((a, b) => a.Name.localeCompare(b.Name, "en-LK"));
const foldName = (value) => value.normalize("NFC").trim().toLocaleLowerCase();

function InventoryMark({ room = false }) {
  return <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
    {room ? <><path d="M9 28V5h14v23M5 28h22M15 5v23M19 16v3" /><path d="M9 5l6 3" /></> : <><path d="M16 4v5m0 14v5M4 16h5m14 0h5M7.5 7.5l3.5 3.5m10 10 3.5 3.5M7.5 24.5 11 21m10-10 3.5-3.5" /><path d="m16 10 1.7 4.3L22 16l-4.3 1.7L16 22l-1.7-4.3L10 16l4.3-1.7Z" /></>}
  </svg>;
}

// Remount forms and recovery state when the active staff session changes.
export default function PropertyInventory({ kind, session }) {
  return <PropertyInventorySession key={`${kind}:${session?.staff?.staffId}:${session?.token}`} kind={kind} session={session} />;
}

function PropertyInventorySession({ kind, session }) {
  const isRoom = kind === "rooms";
  const singular = isRoom ? "room" : "amenity";
  const plural = isRoom ? "rooms" : "amenities";
  const title = isRoom ? "Rooms, thoughtfully arranged" : "The details of a comfortable stay";
  const token = session?.token;
  const staffId = session?.staff?.staffId;
  const permitted = canManageProperty(session?.staff?.role) && isCurrentStaff(token);
  const [initialAttempt] = useState(() => {
    if (!permitted) return { entry: null, error: "" };
    try { return { entry: readPropertyAttempt(kind, staffId), error: "" }; }
    catch (error) { return { entry: { stage: "unverified" }, error: error.message }; }
  });
  const [result, setResult] = useState(emptyResult);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({ branchId: "", roomTypeId: "", status: "" });
  const [draft, setDraft] = useState(isRoom ? emptyRoom : emptyAmenity);
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
  const referencesReady = !isRoom || (result.branches.length > 0 && result.roomTypes.length > 0);
  const editable = permitted && result.loaded && !result.loading && !result.error && referencesReady && !pending && !attempt;

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
      const rows = [...data.rows].sort((a, b) => isRoom
        ? a.BranchName.localeCompare(b.BranchName, "en-LK") || a.BranchID - b.BranchID || a.RoomNumber.localeCompare(b.RoomNumber, "en-LK", { numeric: true }) || a.RoomID - b.RoomID
        : a.AmenityName.localeCompare(b.AmenityName, "en-LK") || a.AmenityID - b.AmenityID);
      setResult({ ...data, rows, branches: sortNames(data.branches), roomTypes: sortNames(data.roomTypes), loading: false, loaded: true, error: "" });
      setInspectedRead(inspection || Boolean(confirmed));
      if (isRoom) {
        setDraft((previous) => ({
          ...previous,
          branchId: data.branches.some((row) => String(row.BranchID) === previous.branchId) ? previous.branchId : "",
          roomTypeId: data.roomTypes.some((row) => String(row.RoomTypeID) === previous.roomTypeId) ? previous.roomTypeId : "",
        }));
      }
      if (confirmed) {
        if (propertyAttemptMatchesCatalogue({ kind, stage: "saved", id: confirmed.id, draft: confirmed }, data)) {
          try {
            clearPropertyAttempt(kind, staffId);
            setAttempt(null);
            setActionError("");
            setInspectedRead(false);
          } catch (error) { setActionError(error.message); }
        } else {
          setActionError(`The ${singular} was added, but its refreshed details need checking. ${isRoom ? "Maintenance rooms are not included in this list. " : ""}Resolve the previous result before adding another entry.`);
        }
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
      // Invalidate and abort the most recent reads and writes, including later user actions.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ++readVersion.current;
      readController.current?.abort();
      // eslint-disable-next-line react-hooks/exhaustive-deps
      actionController.current?.abort();
    };
    // Catalogue kind and session changes remount this component through its key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (review) reviewHeading.current?.focus(); }, [review]);

  function updateDraft(field, value) {
    if (!editable || saving.current) return;
    setDraft((previous) => ({ ...previous, [field]: value }));
    setReview(null);
    setActionError("");
  }

  function reviewDraft(event) {
    event.preventDefault();
    if (!editable || saving.current) return;
    try {
      const normalized = isRoom ? parseRoomDraft(draft) : parseAmenityDraft(draft);
      if (isRoom && (!result.branches.some((row) => row.BranchID === normalized.branchId)
        || !result.roomTypes.some((row) => row.RoomTypeID === normalized.roomTypeId))) {
        throw new Error("Choose a listed branch and room type. Refresh the catalogue if your selection is missing.");
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
    setNotice("");
    setInspectedRead(false);
    setChecked(false);
    const submitted = review;
    const controller = new AbortController();
    actionController.current = controller;
    let confirmed = null;
    try {
      const saved = await createPropertyItem(kind, submitted, token, controller.signal);
      if (!mounted.current || controller.signal.aborted || !isCurrentStaff(token)) return;
      setNotice(isRoom ? `Room ${saved.roomNumber} was added successfully. Room reference: #${saved.id}.` : `${saved.name} was added successfully. Amenity reference: #${saved.id}.`);
      setDraft(isRoom ? emptyRoom() : emptyAmenity());
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
      setDraft(isRoom ? emptyRoom() : emptyAmenity());
      setChecked(false);
      setInspectedRead(false);
      setNotice("The previous save result has been checked. No request was sent again.");
    } catch (error) { setActionError(error.message); }
  }

  function clearFilters() {
    setSearch("");
    setFilters({ branchId: "", roomTypeId: "", status: "" });
  }

  if (!permitted) return <section className="property-page pi-page" aria-labelledby="inventory-heading">
    <div className="pc-access"><p className="pc-eyebrow">PROPERTY MANAGEMENT</p><h1 id="inventory-heading">{title}</h1><p role="alert">Sign in as a manager or administrator to manage rooms and amenities.</p><Link className="pc-button" to="/staff">Return to staff account</Link></div>
  </section>;

  const branchFor = (id) => result.branches.find((row) => row.BranchID === Number(id));
  const typeFor = (id) => result.roomTypes.find((row) => row.RoomTypeID === Number(id));
  const query = search.trim().toLocaleLowerCase();
  const filtered = Boolean(search || filters.branchId || filters.roomTypeId || filters.status);
  const matching = result.rows.filter((row) => {
    if (!isRoom) return `${row.AmenityName} ${row.AmenityID}`.toLocaleLowerCase().includes(query);
    const text = `${row.RoomNumber} ${row.BranchName} ${row.RoomTypeName} ${row.RoomID}`;
    return text.toLocaleLowerCase().includes(query)
      && (!filters.branchId || row.BranchID === Number(filters.branchId))
      && (!filters.roomTypeId || row.RoomTypeID === Number(filters.roomTypeId))
      && (!filters.status || row.RoomStatus === filters.status);
  });
  const selectedType = typeFor(draft.roomTypeId);
  const createReferencesMissing = result.loaded && !result.loading && !result.error && !referencesReady;
  const describeBranch = (id) => `${branchFor(id)?.Name || "Branch"} · #${id}`;
  const describeType = (id) => `${typeFor(id)?.Name || "Room type"} · #${id}`;

  function draftDetails(value) {
    return isRoom ? <>
      <div><dt>Room number</dt><dd>{value.roomNumber}</dd></div>
      <div><dt>Branch</dt><dd>{describeBranch(value.branchId)}</dd></div>
      <div><dt>Room type</dt><dd>{describeType(value.roomTypeId)}</dd></div>
    </> : <div><dt>Amenity name</dt><dd>{value.name}</dd></div>;
  }

  return <section className="property-page pi-page" aria-labelledby="inventory-heading">
    <nav className="pc-breadcrumb" aria-label="Staff workspace"><Link to="/staff/dashboard">Dashboard</Link><span aria-hidden="true">/</span><Link to="/staff">Staff account</Link><span aria-hidden="true">/</span><span>Property management</span></nav>
    <header className="pc-heading"><div><p className="pc-eyebrow">SKYNEST / PROPERTY COLLECTION</p><h1 id="inventory-heading">{title}</h1><p className="pc-intro">{isRoom ? "Keep your room collection organised. Browse by destination and room type, then add the next room to your collection." : "Comfort begins with the little things. Keep the amenities offered across your room types in one considered collection."}</p></div><a className="pc-button" href="#inventory-add" onClick={() => formHeading.current?.focus()}>Add {singular}<span aria-hidden="true">+</span></a></header>
    <nav className="pc-tabs pi-tabs" aria-label="Property catalogues"><Link to="/staff/branches">Branches</Link><Link to="/staff/room-types">Room types</Link><Link to="/staff/rooms" aria-current={isRoom ? "page" : undefined}>Rooms</Link><Link to="/staff/amenities" aria-current={!isRoom ? "page" : undefined}>Amenities</Link></nav>

    {notice && <div className="pc-notice" role="status">{notice}</div>}
    {actionError && <div className="pc-error" role="alert">{actionError}</div>}
    {attempt && <section className="pc-recovery" aria-labelledby="inventory-recovery-heading">
      <p className="pc-eyebrow">CHECK BEFORE CONTINUING</p><h2 id="inventory-recovery-heading">{attempt.stage === "saved" ? `Your ${singular} was added` : "Check the previous save result"}</h2>
      <p>{attempt.stage === "saved" ? "The save was confirmed. Its details need checking before another addition." : `A previous request may already have added a ${singular}. Further additions are paused to help prevent a duplicate.`} Wait until any save in progress has finished, then reload and inspect the details below.</p>
      {isRoom && <p className="pi-recovery-warning">Maintenance rooms are not included in this list. A missing room does not mean the save failed. If you cannot find it or the result is uncertain, ask your administrator to check before adding it again.</p>}
      {!isRoom && <p>If the result remains uncertain, ask your administrator to check before adding the amenity again.</p>}
      {attempt.draft && <dl className="pc-attempt-details">{draftDetails(attempt.draft)}{attempt.id && <div><dt>Saved reference</dt><dd>#{attempt.id}</dd></div>}</dl>}
      <button type="button" className="pc-button pc-button--outline" disabled={result.loading || pending} onClick={() => void reloadCatalogue(true)}>{result.loading ? "Loading catalogue…" : "Reload to inspect"}</button>
      <label className="pc-check"><input type="checkbox" checked={checked} disabled={!inspectedRead || result.loading || Boolean(result.error) || pending} onChange={(event) => setChecked(event.target.checked)} /><span>{isRoom ? "I have resolved the previous save result, including an administrator check if the room is missing." : "I have checked the reloaded catalogue and resolved the previous save result."}</span></label>
      <button type="button" className="pc-button" disabled={!checked || !inspectedRead || result.loading || Boolean(result.error) || pending} onClick={finishInspection}>Finish inspection</button>
    </section>}

    <section className="pc-collection" aria-labelledby="inventory-list-heading">
      <div className="pc-section-heading"><div><p className="pc-eyebrow">{isRoom ? "ACROSS OUR DESTINATIONS" : "OUR ROOM COMFORTS"}</p><h2 id="inventory-list-heading">{isRoom ? "Listed rooms" : "Amenity collection"}</h2></div><button className="pc-text-button" type="button" disabled={result.loading || pending} onClick={() => void reloadCatalogue()}>{result.loading ? "Loading…" : "Refresh catalogue"}<span aria-hidden="true">↻</span></button></div>
      {isRoom ? <div className="pi-list-note"><InventoryMark room /><p><strong>Maintenance rooms are not included in this list.</strong> Room status shows the saved operating status. For availability on particular dates, use <Link to="/rooms">room search</Link>.</p></div> : <p className="pi-collection-note">Amenities belong to room types. Choose their included comforts when <Link to="/staff/room-types">adding a room type</Link>.</p>}
      <div className={`pc-toolbar pi-toolbar${isRoom ? " pi-toolbar--rooms" : ""}`}>
        <div className="pc-field"><label htmlFor="inventory-search">Find {isRoom ? "a room" : "an amenity"}</label><input id="inventory-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={isRoom ? "Number, branch, type or reference" : "Name or reference"} /></div>
        {isRoom && <><div className="pc-field"><label htmlFor="inventory-branch-filter">Branch</label><select id="inventory-branch-filter" value={filters.branchId} onChange={(event) => setFilters((previous) => ({ ...previous, branchId: event.target.value }))}><option value="">All branches</option>{result.branches.map((row) => <option key={row.BranchID} value={row.BranchID}>{row.Name} · #{row.BranchID}</option>)}</select></div><div className="pc-field"><label htmlFor="inventory-type-filter">Room type</label><select id="inventory-type-filter" value={filters.roomTypeId} onChange={(event) => setFilters((previous) => ({ ...previous, roomTypeId: event.target.value }))}><option value="">All room types</option>{result.roomTypes.map((row) => <option key={row.RoomTypeID} value={row.RoomTypeID}>{row.Name} · #{row.RoomTypeID}</option>)}</select></div><div className="pc-field"><label htmlFor="inventory-status-filter">Room status</label><select id="inventory-status-filter" value={filters.status} onChange={(event) => setFilters((previous) => ({ ...previous, status: event.target.value }))}><option value="">All listed statuses</option><option value="Available">Available</option><option value="Occupied">Occupied</option></select></div></>}
      </div>
      {result.loaded && !result.loading && !result.error && <p className="pc-count" aria-live="polite"><strong>{matching.length}</strong> of {result.rows.length} {isRoom ? "listed rooms" : "amenities"}{filtered && <button className="pc-text-button" type="button" onClick={clearFilters}>Clear filters</button>}</p>}
      <div aria-busy={result.loading}>
        {result.loading ? <div className="pc-state" role="status"><span className="pc-state-mark"><InventoryMark room={isRoom} /></span><h3>Loading your {plural}…</h3><p>Retrieving the latest property details.</p></div>
          : result.error ? <div className="pc-state pc-state--error"><h3>We could not refresh the catalogue</h3><p role="alert">{result.error}</p><button className="pc-button" type="button" disabled={pending} onClick={() => void reloadCatalogue()}>Try loading again</button></div>
            : !matching.length ? <div className="pc-state"><span className="pc-state-mark"><InventoryMark room={isRoom} /></span><h3>{filtered ? `No ${plural} match these filters` : isRoom ? "No rooms are listed" : "Your amenity collection starts here"}</h3><p>{filtered ? "Try another search or clear the filters." : isRoom ? "You can add a room below. Existing maintenance rooms will not appear in this list." : "Add a comfort below, then include it when creating a room type."}</p>{filtered && <button type="button" className="pc-button pc-button--outline" onClick={clearFilters}>Clear filters</button>}</div>
              : isRoom ? <div className="pi-room-grid">{matching.map((row) => <article className="pi-room-card" key={row.RoomID}>
                <div className="pi-room-top"><span className="pi-room-label">ROOM / {row.RoomNumber}</span><span className={`pi-status pi-status--${row.RoomStatus.toLowerCase()}`}><span className="pc-sr-only">Room status: </span>{row.RoomStatus}</span></div>
                <h3>{row.RoomTypeName}</h3><p className="pi-room-branch">{row.BranchName}</p>
                <dl className="pi-room-details"><div><dt>Guest capacity</dt><dd>{row.Capacity} <span>{row.Capacity === 1 ? "guest" : "guests"}</span></dd></div><div><dt>Catalogue rate / night</dt><dd className="pi-room-rate">{formatMoney(row.DailyRate)}</dd></div></dl>
                <footer className="pi-room-reference">Room #{row.RoomID}<span>Branch #{row.BranchID} · Type #{row.RoomTypeID}</span></footer>
              </article>)}</div>
                : <div className="pc-cards pi-amenity-grid">{matching.map((row) => {
                  const sameNames = result.rows.filter((item) => foldName(item.AmenityName) === foldName(row.AmenityName));
                  const ambiguous = sameNames.length !== 1;
                  const linkedTypes = ambiguous ? [] : result.roomTypes.filter((item) => item.amenities.includes(row.AmenityName));
                  return <article className="pc-card pi-amenity-card" key={row.AmenityID}><div className="pc-card-top"><span className="pc-card-mark"><InventoryMark /></span><span className="pc-reference">AMENITY / {String(row.AmenityID).padStart(2, "0")}</span></div><h3>{row.AmenityName}</h3><div className="pi-amenity-links"><h4>Included in room types</h4>{ambiguous ? <p>Matching amenity names make these links unclear. Check the room types for details.</p> : linkedTypes.length ? <ul>{linkedTypes.map((type) => <li key={type.RoomTypeID}>{type.Name}<span>#{type.RoomTypeID}</span></li>)}</ul> : <p>No room types currently list this amenity.</p>}</div></article>;
                })}</div>}
      </div>
    </section>

    <section className="pc-editor" id="inventory-add" aria-labelledby="inventory-form-heading">
      <aside className="pc-editor-intro"><span className="pc-editor-mark"><InventoryMark room={isRoom} /></span><p className="pc-eyebrow">GROW THE COLLECTION</p><h2 id="inventory-form-heading" ref={formHeading} tabIndex={-1}>{isRoom ? "A place for the next guest" : "Another thoughtful detail"}</h2><p>{isRoom ? "Choose the hotel and room type, then enter the number used by your team to identify this room." : "Give the amenity a clear, familiar name that guests and your team will recognise."}</p><ol className="pc-steps"><li><span>01</span>Enter the details</li><li><span>02</span>Review your entry</li><li><span>03</span>Confirm and add</li></ol><p className="pc-editor-footnote">{isRoom ? "The room type supplies the capacity, nightly rate and included amenities. Adding a room does not create a booking." : "Adding an amenity creates a catalogue entry. Include it when creating a new room type to offer it with those rooms."}</p></aside>
      <div className="pc-editor-content">
        {createReferencesMissing && <p className="pi-reference-notice">To add a room, first create {!result.branches.length && <Link to="/staff/branches">a branch</Link>}{!result.branches.length && !result.roomTypes.length && " and "}{!result.roomTypes.length && <Link to="/staff/room-types">a room type</Link>}. Then return and refresh this catalogue.</p>}
        <form className="pc-form" onSubmit={reviewDraft}><fieldset disabled={!editable || Boolean(review)}><legend className="pc-sr-only">New {singular} details</legend>
          {isRoom ? <>
            <div className="pc-field"><label htmlFor="inventory-branch">Hotel branch</label><select id="inventory-branch" required value={draft.branchId} onChange={(event) => updateDraft("branchId", event.target.value)}><option value="">Select a branch</option>{result.branches.map((row) => <option key={row.BranchID} value={row.BranchID}>{row.Name} · #{row.BranchID}</option>)}</select>{branchFor(draft.branchId) && <span className="pc-hint">{branchFor(draft.branchId).Location}</span>}</div>
            <div className="pc-field"><label htmlFor="inventory-type">Room type</label><select id="inventory-type" required value={draft.roomTypeId} onChange={(event) => updateDraft("roomTypeId", event.target.value)}><option value="">Select a room type</option>{result.roomTypes.map((row) => <option key={row.RoomTypeID} value={row.RoomTypeID}>{row.Name} · #{row.RoomTypeID}</option>)}</select></div>
            {selectedType && <div className="pi-type-preview"><p className="pc-eyebrow">SELECTED ROOM TYPE</p><p><strong>{selectedType.Capacity}</strong> {selectedType.Capacity === 1 ? "guest" : "guests"}<span>{formatMoney(selectedType.DailyRate)} / night</span></p><p className="pc-hint">{selectedType.amenities.length ? selectedType.amenities.join(" · ") : "No amenities linked to this room type."}</p></div>}
            <div className="pc-field"><label htmlFor="inventory-number">Room number</label><input id="inventory-number" type="text" required maxLength={10} value={draft.roomNumber} onChange={(event) => updateDraft("roomNumber", event.target.value)} placeholder="For example, 203 or A-12" aria-describedby="inventory-number-hint" /><span id="inventory-number-hint" className="pc-hint">Up to 10 characters. Use a number or label not already assigned at this branch.</span></div>
          </> : <div className="pc-field"><label htmlFor="inventory-name">Amenity name</label><input id="inventory-name" type="text" required maxLength={100} value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} placeholder="For example, Tea and coffee facilities" aria-describedby="inventory-name-hint" /><span id="inventory-name-hint" className="pc-hint">Use a distinct name, up to 100 characters.</span></div>}
          <button className="pc-button" type="submit">Review {singular}<span aria-hidden="true">→</span></button>
        </fieldset></form>
        {!editable && !review && !pending && !createReferencesMissing && <p className="pc-form-paused">{attempt ? "Complete the inspection above before adding another entry." : "Load the latest catalogue to enable this form."}</p>}
        {review && <section className="pc-review" aria-labelledby="inventory-review-heading"><p className="pc-eyebrow">REVIEW BEFORE ADDING</p><h3 id="inventory-review-heading" ref={reviewHeading} tabIndex={-1}>Ready to add this {singular}?</h3><dl>{draftDetails(review)}{isRoom && typeFor(review.roomTypeId) && <><div><dt>Guest capacity</dt><dd>{typeFor(review.roomTypeId).Capacity}</dd></div><div><dt>Current room-type rate / night</dt><dd>{formatMoney(typeFor(review.roomTypeId).DailyRate)}</dd></div></>}</dl><p className="pc-hint">{isRoom ? "The room will start with Available status. Booking-date availability is checked separately." : "This adds the amenity to the catalogue. Existing room-type selections stay the same."}</p><div className="pc-review-actions"><button className="pc-button" type="button" disabled={!editable || pending} onClick={() => void confirmCreate()}>{pending ? `Adding ${singular}…` : `Confirm & add ${singular}`}</button><button className="pc-button pc-button--outline" type="button" disabled={pending} onClick={() => { setReview(null); formHeading.current?.focus(); }}>Back to details</button></div></section>}
      </div>
    </section>
    <footer className="pc-footer"><p>{isRoom ? "Looking for a room for a particular stay?" : "Ready to include these comforts in a room category?"} <Link to={isRoom ? "/rooms" : "/staff/room-types"}>{isRoom ? "Open room search" : "View room types"}<span aria-hidden="true"> ↗</span></Link></p></footer>
  </section>;
}
