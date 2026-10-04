import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { loadBranches } from "../services/branchApi";
import { getLocalToday, validateStay } from "../services/roomApi";
import "./Home.css";

const destinations = [
  { city: "Colombo", theme: "THE CITY", image: "branch-colombo.jpg", description: "A change of pace in the capital. Discover the city, then make time to unwind." },
  { city: "Kandy", theme: "THE HILL COUNTRY", image: "branch-kandy.jpg", description: "Take the scenic route. Let the hills set the rhythm for your next escape." },
  { city: "Galle", theme: "THE SOUTH COAST", image: "branch-galle.jpg", description: "Follow the coast south, where a slower day is always a good idea." },
];

function StaySearch() {
  const navigate = useNavigate();
  const [branches, setBranches] = useState([]);
  const [branchStatus, setBranchStatus] = useState("loading");
  const [filters, setFilters] = useState({ branchId: "", checkin: "", checkout: "", guests: "1" });
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    loadBranches(controller.signal)
      .then((rows) => { if (!controller.signal.aborted) { setBranches(rows); setBranchStatus("ready"); } })
      .catch(() => { if (!controller.signal.aborted) setBranchStatus("error"); });
    return () => controller.abort();
  }, []);

  function change(event) {
    setError("");
    setFilters((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  function submit(event) {
    event.preventDefault();
    try {
      const stay = validateStay(filters);
      navigate("/rooms", { state: { roomSearch: { ...filters, guests: String(stay.guests) } } });
    } catch (failure) {
      setError(failure.message);
    }
  }

  return <div className="home-search-panel">
    <div className="home-search-heading"><span>YOUR NEXT CHAPTER</span><p>Find your stay</p></div>
    <form className="home-stay-search" onSubmit={submit} aria-label="Plan your stay">
      <div className="home-search-field">
        <label htmlFor="home-destination">Destination</label>
        <select id="home-destination" name="branchId" value={filters.branchId} onChange={change} disabled={branchStatus !== "ready"}>
          <option value="">{branchStatus === "loading" ? "Loading destinations…" : "All destinations"}</option>
          {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
        </select>
      </div>
      <div className="home-search-field"><label htmlFor="home-checkin">Check-in</label><input id="home-checkin" type="date" name="checkin" min={getLocalToday()} value={filters.checkin} onChange={change} required /></div>
      <div className="home-search-field"><label htmlFor="home-checkout">Check-out</label><input id="home-checkout" type="date" name="checkout" min={filters.checkin || getLocalToday()} value={filters.checkout} onChange={change} required /></div>
      <div className="home-search-field"><label htmlFor="home-guests">Guests / room</label><input id="home-guests" type="number" name="guests" min="1" step="1" value={filters.guests} onChange={change} required /></div>
      <button className="home-search-submit" type="submit">Find rooms <span aria-hidden="true">↗</span></button>
      {error && <p className="home-search-error" role="alert">{error}</p>}
    </form>
    {branchStatus === "error" && <p className="home-search-note" role="status">Destinations could not be loaded. <Link to="/rooms">Open room search</Link> to try again.</p>}
    <p className="home-search-note">Continue to room search to check availability and current rates.</p>
  </div>;
}

export default function Home() {
  return <div className="hotel-home">
    <section className="home-hero" aria-labelledby="home-heading">
      <img className="home-hero-image" src="/images/hotel/hero.jpg" alt="" width="1920" height="1280" fetchPriority="high" />
      <div className="home-hero-shade" />
      <div className="home-hero-content">
        <p className="home-kicker">SKYNEST HOTELS · SRI LANKA</p>
        <h1 id="home-heading">Some places<br />stay with you.</h1>
        <p className="home-hero-description">A city break. A hillside pause. A coastal escape.<br className="home-desktop-break" /> Find your own way to stay with SkyNest.</p>
        <div className="home-hero-actions"><Link className="home-button home-button-gold" to="/rooms">Explore our rooms <span aria-hidden="true">↗</span></Link><Link className="home-hero-link" to="/branches">Discover our destinations <span aria-hidden="true">→</span></Link></div>
      </div>
      <div className="home-hero-location"><span aria-hidden="true">01 /</span> COLOMBO · KANDY · GALLE</div>
    </section>

    <StaySearch />

    <section className="home-destinations" aria-labelledby="home-destinations-heading">
      <div className="home-section-heading">
        <div><p className="home-kicker">ONE ISLAND. YOUR KIND OF ESCAPE.</p><h2 id="home-destinations-heading">Three destinations.<br /><em>So many ways to stay.</em></h2></div>
        <div className="home-section-intro"><p>From the energy of Colombo to the hills of Kandy and the coast of Galle, discover a different side of Sri Lanka.</p><Link className="home-text-link" to="/branches">Explore all branches <span aria-hidden="true">→</span></Link></div>
      </div>
      <div className="home-destination-grid">
        {destinations.map((destination, index) => <article className="home-destination-card" key={destination.city}>
          <Link className="home-destination-photo" to={`/branches#${destination.city.toLowerCase()}`} aria-label={`Explore ${destination.city}`}><img src={`/images/hotel/${destination.image}`} alt={`Illustrative ${destination.city} destination photograph`} width="768" height="540" loading="lazy" /><span className="home-destination-number">0{index + 1}</span><span className="home-photo-arrow" aria-hidden="true">↗</span></Link>
          <p className="home-kicker">{destination.theme}</p><h3><Link to={`/branches#${destination.city.toLowerCase()}`}>{destination.city}</Link></h3><p>{destination.description}</p>
        </article>)}
      </div>
    </section>

    <section className="home-room-story" aria-labelledby="home-room-heading">
      <div className="home-story-photos"><img className="home-room-main" src="/images/hotel/room-family.jpg" alt="Illustrative guest room with warm wood finishes" width="800" height="600" loading="lazy" /><img className="home-room-detail" src="/images/hotel/room-standard.jpg" alt="Illustrative room interior" width="800" height="533" loading="lazy" /><span className="home-story-caption">SPACE TO SIMPLY BE.</span></div>
      <div className="home-story-copy"><p className="home-kicker">SETTLE IN, SLOW DOWN</p><h2 id="home-room-heading">Make room<br />for <em>a little rest.</em></h2><p>Every journey deserves a place to pause. Explore our room types and choose a stay that fits your plans.</p><p className="home-story-detail">Select your dates and guests to see available rooms, current nightly rates and your estimated room charge.</p><Link className="home-button home-button-green" to="/rooms">Find your room <span aria-hidden="true">↗</span></Link></div>
    </section>

    <section className="home-services-story" aria-labelledby="home-services-heading">
      <div className="home-services-copy"><p className="home-kicker">THE LITTLE THINGS, TAKEN CARE OF</p><h2 id="home-services-heading">More to<br /><em>your stay.</em></h2><p>Discover our guest services and current prices. When you are ready, our staff can help arrange a service during your stay.</p><Link className="home-text-link" to="/services">Explore guest services <span aria-hidden="true">→</span></Link></div>
      <div className="home-service-photo"><img src="/images/hotel/service-spa.jpg" alt="Illustrative guest comforts: folded towels and flowers" width="600" height="400" loading="lazy" /></div>
    </section>

    <section className="home-closing" aria-labelledby="home-closing-heading"><p className="home-kicker">YOUR NEXT STAY STARTS HERE</p><h2 id="home-closing-heading">Where will you find yourself?</h2><Link className="home-button home-button-green" to="/rooms">Plan your stay <span aria-hidden="true">↗</span></Link></section>
    <p className="home-image-note">Hotel and room photographs are illustrative.</p>
  </div>;
}
