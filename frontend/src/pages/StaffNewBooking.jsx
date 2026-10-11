import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { createGuest, searchGuests } from "../services/staffGuestBookingApi";
import "./StaffBookingList.css";
import "./StaffNewBooking.css";

const emptyForm = { name: "", contactNumber: "", email: "", idNumber: "", address: "" };

export default function StaffNewBooking({ session }) {
  const navigate = useNavigate();
  const token = session.token;
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState({ status: "idle", guests: [], error: "", term: "" });
  const [registering, setRegistering] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [create, setCreate] = useState({ pending: false, error: "" });
  const searchRequest = useRef(null);
  const createRequest = useRef(null);

  useEffect(() => () => {
    searchRequest.current?.abort();
    createRequest.current?.abort();
  }, []);

  function proceed(guest) {
  navigate("/staff/rooms", {
    state: { bookingFor: { guestId: guest.GuestID, name: guest.Name, contactNumber: guest.ContactNumber } },
  });
}

  async function handleSearch(event) {
    event.preventDefault();
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
      if (!controller.signal.aborted) setSearch({ status: "done", guests, error: "", term });
    } catch (error) {
      if (!controller.signal.aborted && error.name !== "AbortError") {
        setSearch({ status: "error", guests: [], error: error.message, term });
      }
    }
  }

  async function handleCreate(event) {
    event.preventDefault();
    if (create.pending) return;
    const controller = new AbortController();
    createRequest.current = controller;
    setCreate({ pending: true, error: "" });
    const details = Object.fromEntries(
      Object.entries(form).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value),
    );
    try {
      const guest = await createGuest(details, token, controller.signal);
      if (!controller.signal.aborted) proceed(guest);
    } catch (error) {
      if (!controller.signal.aborted && error.name !== "AbortError") {
        setCreate({ pending: false, error: error.message });
      }
    }
  }

  const setField = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));

  return (
    <section className="staff-bookings-page staff-new-booking" aria-labelledby="staff-new-booking-heading">
      <nav className="sb-breadcrumb" aria-label="Breadcrumb">
        <Link to="/staff">Staff</Link><span aria-hidden="true">/</span>
        <Link to="/staff/bookings">Bookings</Link><span aria-hidden="true">/</span>
        <span>New booking</span>
      </nav>

      <header className="sb-heading">
        <div>
          <p className="sb-eyebrow">FRONT DESK</p>
          <h1 id="staff-new-booking-heading">New booking</h1>
          <p>Find the guest this booking is for, or register them if they are new.</p>
        </div>
      </header>

      <section className="sb-search-panel" aria-labelledby="guest-search-heading">
        <div className="sb-panel-heading">
          <h2 id="guest-search-heading">Find an existing guest</h2>
          <p>Search by name, contact number or email.</p>
        </div>
        <form className="sb-filters" onSubmit={handleSearch}>
          <div className="sb-field sb-field--wide">
            <label htmlFor="guest-query">Name, contact number, email or NIC / passport</label>
            <input id="guest-query" value={query} onChange={(event) => setQuery(event.target.value)} autoComplete="off" />
          </div>
          <div className="sb-filter-actions">
            <button className="sb-button" type="submit" disabled={search.status === "loading"}>
              {search.status === "loading" ? "Searching…" : "Search guests"}
            </button>
          </div>
        </form>

        {search.status === "error" && <p className="sb-notice" role="alert">{search.error}</p>}
        {search.status === "done" && search.guests.length === 0 && (
          <p className="sb-notice" role="status">No guests match “{search.term}”. You can register them below.</p>
        )}
        {search.guests.length > 0 && (
          <div className="sb-results">
            <p className="sb-count" role="status">{search.guests.length} {search.guests.length === 1 ? "guest" : "guests"} found.</p>
            <ul className="sb-guest-results">
              {search.guests.map((guest) => (
                <li className="sb-guest-result" key={guest.GuestID}>
                  <div>
                    <strong>{guest.Name}</strong>
                    <span>{guest.ContactNumber}{guest.Email ? ` · ${guest.Email}` : ""}{guest.IDNumber ? ` · ${guest.IDNumber}` : ""}</span>
                  </div>
                  <button className="sb-button" type="button" onClick={() => proceed(guest)}>
                    Book for this guest
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="sb-search-panel" aria-labelledby="guest-register-heading">
        <div className="sb-panel-heading">
          <h2 id="guest-register-heading">New guest</h2>
          <p>For walk-ins who do not have a guest record yet. No online account is created.</p>
        </div>
        {!registering ? (
          <button className="sb-button" type="button" onClick={() => setRegistering(true)}>Register a new guest</button>
        ) : (
          <form className="sb-filters" onSubmit={handleCreate} aria-busy={create.pending}>
            <div className="sb-field">
              <label htmlFor="new-guest-name">Full name</label>
              <input id="new-guest-name" name="name" value={form.name} onChange={setField} required />
            </div>
            <div className="sb-field">
              <label htmlFor="new-guest-contact">Contact number</label>
              <input id="new-guest-contact" name="contactNumber" value={form.contactNumber} onChange={setField} required />
            </div>
            <div className="sb-field">
              <label htmlFor="new-guest-email">Email (optional)</label>
              <input id="new-guest-email" name="email" type="email" value={form.email} onChange={setField} />
            </div>
            <div className="sb-field">
              <label htmlFor="new-guest-id">NIC / passport number (optional)</label>
              <input id="new-guest-id" name="idNumber" value={form.idNumber} onChange={setField} />
            </div>
            <div className="sb-field sb-field--wide">
              <label htmlFor="new-guest-address">Address (optional)</label>
              <input id="new-guest-address" name="address" value={form.address} onChange={setField} />
            </div>
            <div className="sb-filter-actions">
              <button className="sb-button" type="submit" disabled={create.pending}>
                {create.pending ? "Saving…" : "Save guest and continue"}
              </button>
            </div>
            {create.error && <p className="sb-notice" role="alert" style={{ gridColumn: "1 / -1" }}>{create.error}</p>}
          </form>
        )}
      </section>
    </section>
  );
}