import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  clearGuestCreationAttempt, createGuest, loadFrontDeskScope, parseGuestDraft,
  readGuestCreationAttempt, searchGuests,
} from "../services/staffGuestBookingApi";
import { isCurrentStaff } from "../services/staffBookingApi";
import "./StaffBookingList.css";
import "./StaffNewBooking.css";

const emptyForm = () => ({ name: "", contactNumber: "", email: "", idNumber: "", address: "" });
const allowedRoles = ["Admin", "Manager", "Receptionist"];

export default function StaffNewBooking({ session }) {
  return <StaffNewBookingSession key={`${session?.staff?.staffId}:${session?.token}`} session={session} />;
}

function StaffNewBookingSession({ session }) {
  const navigate = useNavigate();
  const token = session?.token;
  const permitted = allowedRoles.includes(session?.staff?.role) && isCurrentStaff(token);
  const [access, setAccess] = useState({ loading: true, scope: null, error: "" });
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState({ status: "idle", guests: [], error: "", term: "" });
  const [registering, setRegistering] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [attempt, setAttempt] = useState(null);
  const [confirmedNotCreated, setConfirmedNotCreated] = useState(false);
  const [create, setCreate] = useState({ pending: false, error: "" });
  const mounted = useRef(false);
  const busy = useRef(false);
  const scopeRequest = useRef(null);
  const searchRequest = useRef(null);
  const createRequest = useRef(null);
  const createError = useRef(null);
  const receiptHeading = useRef(null);
  const searchInput = useRef(null);
  const ready = permitted && !access.loading && Boolean(access.scope) && !access.error;

  async function checkAccess() {
    if (!permitted || busy.current || !isCurrentStaff(token)) return;
    scopeRequest.current?.abort();
    const controller = new AbortController();
    scopeRequest.current = controller;
    setAccess({ loading: true, scope: null, error: "" });
    try {
      const scope = await loadFrontDeskScope(token, controller.signal);
      if (!mounted.current || controller.signal.aborted || !isCurrentStaff(token)) return;
      // Restore a saved guest only after the current account's access is verified.
      try {
        setAttempt(readGuestCreationAttempt(scope.staffId));
      } catch (error) {
        setAttempt({ stage: "unverified" });
        setCreate({ pending: false, error: error.message });
      }
      setAccess({ loading: false, scope, error: "" });
    } catch (error) {
      if (!mounted.current || controller.signal.aborted || !isCurrentStaff(token) || error.name === "AbortError") return;
      setAccess({ loading: false, scope: null, error: error.message });
    }
  }

  useEffect(() => {
    mounted.current = true;
    void checkAccess();
    return () => {
      mounted.current = false;
      scopeRequest.current?.abort();
      searchRequest.current?.abort();
      createRequest.current?.abort();
    };
    // Session changes remount this component, clearing drafts and search results.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (create.error) createError.current?.focus(); }, [create.error]);
  useEffect(() => { if (ready && attempt?.stage === "saved") receiptHeading.current?.focus(); }, [ready, attempt]);

  function proceed(guest) {
    if (!ready || busy.current || !isCurrentStaff(token)) return;
    navigate("/staff/bookings/rooms", {
      state: { bookingFor: { guestId: guest.GuestID, name: guest.Name, contactNumber: guest.ContactNumber } },
    });
  }

  async function handleSearch(event) {
    event.preventDefault();
    if (!ready || !isCurrentStaff(token)) return;
    const term = query.trim();
    searchRequest.current?.abort();
    if (term.length < 2) {
      setSearch({ status: "error", guests: [], error: "Enter at least 2 characters.", term });
      return;
    }
    const controller = new AbortController();
    searchRequest.current = controller;
    setSearch({ status: "loading", guests: [], error: "", term });
    try {
      const guests = await searchGuests(term, token, controller.signal);
      if (mounted.current && !controller.signal.aborted && isCurrentStaff(token)) {
        setSearch({ status: "done", guests, error: "", term });
      }
    } catch (error) {
      if (mounted.current && !controller.signal.aborted && isCurrentStaff(token) && error.name !== "AbortError") {
        setSearch({ status: "error", guests: [], error: error.message, term });
      }
    }
  }

  async function handleCreate(event) {
    event.preventDefault();
    if (!ready || busy.current || attempt || !isCurrentStaff(token)) return;
    let details;
    try { details = parseGuestDraft(form); }
    catch (error) { setCreate({ pending: false, error: error.message }); return; }
    busy.current = true;
    const controller = new AbortController();
    createRequest.current = controller;
    setCreate({ pending: true, error: "" });
    try {
      const guest = await createGuest(details, token, controller.signal);
      if (!mounted.current || controller.signal.aborted || !isCurrentStaff(token)) return;
      searchRequest.current?.abort();
      setSearch({ status: "idle", guests: [], error: "", term: "" });
      setAttempt({ stage: "saved", guest });
      setForm(emptyForm());
    } catch (error) {
      if (!mounted.current || !isCurrentStaff(token)) return;
      try {
        const savedAttempt = readGuestCreationAttempt(access.scope.staffId);
        setAttempt(savedAttempt || (error.outcomeUnknown ? { stage: "pending" } : null));
      } catch {
        setAttempt({ stage: "unverified" });
      }
      setCreate({ pending: false, error: error.message });
    } finally {
      busy.current = false;
      if (mounted.current && isCurrentStaff(token)) setCreate((current) => ({ ...current, pending: false }));
    }
  }

  function startAnotherGuest() {
    if (!ready || busy.current || !isCurrentStaff(token)) return;
    try {
      clearGuestCreationAttempt(access.scope.staffId, { confirmedNotCreated });
      setAttempt(null);
      setConfirmedNotCreated(false);
      setForm(emptyForm());
      setRegistering(true);
      setCreate({ pending: false, error: "" });
    } catch (error) { setCreate({ pending: false, error: error.message }); }
  }

  function setField(event) {
    if (!ready || busy.current || attempt) return;
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
    setCreate({ pending: false, error: "" });
  }

  if (!permitted) return <section className="staff-bookings-page staff-new-booking">
    <div className="sb-state"><p className="sb-eyebrow">FRONT DESK</p><h1>Booking access required</h1>
      <p>Receptionists, managers and administrators can create bookings. Return to your workspace to continue with your available tasks.</p>
      <Link className="sb-button" to="/staff">Back to staff workspace</Link>
    </div>
  </section>;

  const receipt = attempt?.stage === "saved" ? attempt.guest : null;
  return (
    <section className="staff-bookings-page staff-new-booking" aria-labelledby="staff-new-booking-heading">
      <nav className="sb-breadcrumb" aria-label="Breadcrumb">
        <Link to="/staff">Staff</Link><span aria-hidden="true">/</span>
        <Link to="/staff/bookings">Bookings</Link><span aria-hidden="true">/</span>
        <span>New booking</span>
      </nav>
      <header className="sb-heading">
        <div><p className="sb-eyebrow">FRONT DESK</p><h1 id="staff-new-booking-heading">New booking</h1>
          <p>Find the guest this booking is for, or register them if they are new.</p></div>
        {ready && <div className="sb-access"><span>Booking access</span><strong>{access.scope.role === "Receptionist" ? access.scope.branchName : "All branches"}</strong></div>}
      </header>
      <ol className="snb-steps" aria-label="Booking steps"><li aria-current="step"><span>01</span> Choose guest</li><li><span>02</span> Find rooms</li><li><span>03</span> Review booking</li></ol>

      {access.loading ? <div className="sb-state" role="status"><h2>Preparing your booking workspace</h2><p>Checking your access before loading guest details.</p></div>
        : access.error ? <div className="sb-state sb-state--error"><h2>We could not prepare this page</h2><p role="alert">{access.error}</p><button className="sb-button" type="button" onClick={checkAccess}>Try again</button></div>
          : <>
      <section className="sb-search-panel" aria-labelledby="guest-search-heading">
        <div className="sb-panel-heading"><h2 id="guest-search-heading">Find an existing guest</h2><p>Search first to avoid creating another record for the same person.</p></div>
        <form className="sb-filters" onSubmit={handleSearch}>
          <div className="sb-field sb-field--wide"><label htmlFor="guest-query">Name, contact number, email or NIC / passport</label>
            <input ref={searchInput} id="guest-query" value={query} maxLength={100} onChange={(event) => setQuery(event.target.value)} autoComplete="off" /></div>
          <div className="sb-filter-actions"><button className="sb-button" type="submit" disabled={search.status === "loading"}>{search.status === "loading" ? "Searching…" : "Search guests"}</button></div>
        </form>
        {search.status === "error" && <p className="sb-notice" role="alert">{search.error}</p>}
        {search.status === "done" && search.guests.length === 0 && <p className="sb-notice" role="status">No guests match “{search.term}”. {attempt && !receipt ? "If a previous save is uncertain, wait for that request to finish and check its result before registering this person again." : receipt ? "To register another guest, choose ‘Register a different guest’ below." : "If they are new, you can register them below."}</p>}
        {search.guests.length > 0 && <div className="sb-results"><p className="sb-count" role="status">{search.guests.length} {search.guests.length === 1 ? "guest" : "guests"} found.</p>
          <ul className="sb-guest-results">{search.guests.map((guest) => <li className="sb-guest-result" key={guest.GuestID}><div><strong>{guest.Name}</strong><span>Guest #{guest.GuestID} · {guest.ContactNumber}{guest.Email ? ` · ${guest.Email}` : ""}{guest.IDNumber ? ` · ${guest.IDNumber}` : ""}</span></div><button className="sb-button" type="button" disabled={create.pending} onClick={() => proceed(guest)}>Book for this guest</button></li>)}</ul>
        </div>}
      </section>

      <section className="sb-search-panel" aria-labelledby="guest-register-heading">
        <div className="sb-panel-heading"><h2 id="guest-register-heading">{receipt ? "Guest saved" : "New guest"}</h2><p>For walk-ins who do not have a guest record yet. No online account is created.</p></div>
        {create.error && <p className="sb-notice snb-error" role="alert" tabIndex="-1" ref={createError}>{create.error}</p>}
        {receipt ? <div className="snb-saved"><p className="sb-eyebrow">READY TO BOOK</p><h3 ref={receiptHeading} tabIndex="-1">{receipt.Name}</h3><p>Guest #{receipt.GuestID} · {receipt.ContactNumber}</p><p>This guest has been saved. Continue to choose rooms; their details will not be submitted again.</p>{receipt.storageNotice && <p className="sb-notice" role="status">{receipt.storageNotice}</p>}<div className="snb-actions"><button className="sb-button" type="button" onClick={() => proceed(receipt)}>Continue booking <span aria-hidden="true">→</span></button><button className="sb-clear" type="button" onClick={startAnotherGuest}>Register a different guest</button></div></div>
          : attempt ? <div className="snb-recovery"><h3>{attempt.stage === "pending" ? "Check the previous guest request" : "Guest registration is paused"}</h3><p>A previous save could not be confirmed. The guest may already have been registered.</p><p>Wait for the original request to finish, then search above using the guest’s contact number or NIC / passport. If you find the correct guest, select “Book for this guest”.</p><button className="sb-clear" type="button" onClick={() => searchInput.current?.focus()}>Go to guest search</button>
            {attempt.stage === "pending" ? <><label className="snb-confirm"><input type="checkbox" checked={confirmedNotCreated} onChange={(event) => setConfirmedNotCreated(event.target.checked)} /><span>The original request has finished. I have checked and confirmed that this guest was <strong>not created</strong>.</span></label><button className="sb-button" type="button" disabled={!confirmedNotCreated} onClick={startAnotherGuest}>Start a new guest request</button></> : <p>If you cannot confirm the previous result, ask your system administrator for help before registering another guest.</p>}
          </div>
            : !registering ? <button className="sb-button" type="button" onClick={() => setRegistering(true)}>Register a new guest</button>
              : <form className="snb-create-form" onSubmit={handleCreate} noValidate aria-busy={create.pending}>
                <p className="snb-form-note">All fields are required unless marked optional.</p>
                <fieldset className="sb-filters" disabled={create.pending}><legend className="snb-sr-only">New guest details</legend>
                  <div className="sb-field"><label htmlFor="new-guest-name">Full name</label><input id="new-guest-name" name="name" value={form.name} onChange={setField} maxLength={100} autoComplete="name" required /></div>
                  <div className="sb-field"><label htmlFor="new-guest-contact">Contact number</label><input id="new-guest-contact" name="contactNumber" type="tel" value={form.contactNumber} onChange={setField} maxLength={100} autoComplete="tel" required /></div>
                  <div className="sb-field"><label htmlFor="new-guest-email">Email (optional)</label><input id="new-guest-email" name="email" type="email" value={form.email} onChange={setField} maxLength={150} autoComplete="email" /></div>
                  <div className="sb-field"><label htmlFor="new-guest-id">NIC / passport number</label><input id="new-guest-id" name="idNumber" value={form.idNumber} onChange={setField} maxLength={30} autoComplete="off" aria-describedby="new-guest-id-hint" required /><small id="new-guest-id-hint">Required · up to 30 characters.</small></div>
                  <div className="sb-field sb-field--wide"><label htmlFor="new-guest-address">Address (optional)</label><input id="new-guest-address" name="address" value={form.address} onChange={setField} maxLength={255} autoComplete="street-address" /></div>
                  <div className="snb-actions snb-full"><button className="sb-button" type="submit">{create.pending ? "Saving guest…" : "Save guest"}</button><button className="sb-clear" type="button" onClick={() => { if (!busy.current) setRegistering(false); }}>Cancel registration</button></div>
                </fieldset>
                {create.pending && <p className="snb-form-note" role="status">Please wait for confirmation before starting another guest request.</p>}
              </form>}
      </section>
      </>}
    </section>
  );
}
