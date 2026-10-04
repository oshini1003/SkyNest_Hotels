import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { loadBranches } from "../services/branchApi";
import "./Branches.css";

const destinations = [
  { city: "colombo", label: "The rhythm of the city", image: "branch-colombo.jpg", copy: "Let Colombo’s city life set the pace for your next escape." },
  { city: "kandy", label: "A hillside perspective", image: "branch-kandy.jpg", copy: "Find your inspiration in Kandy’s hillside setting." },
  { city: "galle", label: "A coastal state of mind", image: "branch-galle.jpg", copy: "Look towards Galle for a change of pace by the coast." },
];

function destinationFor(branch) {
  const details = `${branch.name} ${branch.location}`.toLowerCase();
  return destinations.find(({ city }) => details.includes(city)) || {
    city: "", label: "Your next destination", image: "hero.jpg",
    copy: "Choose your dates and discover your next SkyNest stay.",
  };
}

function phoneHref(value) {
  if (!/^\+?[\d\s().-]+$/.test(value)) return undefined;
  const digits = value.replace(/[^\d]/g, "");
  if (digits.length < 3 || digits.length > 20) return undefined;
  return `tel:${value.startsWith("+") ? "+" : ""}${digits}`;
}

function Arrow() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" /></svg>;
}

function BranchCard({ branch, destination, anchor, index }) {
  const contactHref = phoneHref(branch.contactNumber);
  return (
    <article className="sk-branch-card" id={anchor} aria-labelledby={`branch-title-${branch.id}`} tabIndex={-1}>
      <div className="sk-branch-image">
        <img src={`/images/hotel/${destination.image}`} alt="" loading={index === 0 ? "eager" : "lazy"} width="800" height="900" />
        <span className="sk-branch-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
      </div>
      <div className="sk-branch-content">
        <p className="sk-branch-kicker">{destination.label}</p>
        <h2 id={`branch-title-${branch.id}`}>{branch.name}</h2>
        <p className="sk-branch-description">{destination.copy}</p>
        {(branch.location || branch.contactNumber) && (
          <dl className="sk-branch-details">
            {branch.location && <div><dt>Location</dt><dd>{branch.location}</dd></div>}
            {branch.contactNumber && <div><dt>Contact</dt><dd>{contactHref ? <a href={contactHref}>{branch.contactNumber}</a> : branch.contactNumber}</dd></div>}
          </dl>
        )}
        <Link className="sk-branch-room-link" to="/rooms" state={{ roomSearch: { branchId: String(branch.id) } }} aria-label={`Find a room at ${branch.name}`}>
          Find a room <Arrow />
        </Link>
      </div>
    </article>
  );
}

export default function Branches() {
  const { hash } = useLocation();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState({ status: "loading", branches: [], error: "" });

  useEffect(() => {
    const controller = new AbortController();
    loadBranches(controller.signal).then((branches) => {
      if (!controller.signal.aborted) setResult({ status: "ready", branches, error: "" });
    }).catch((error) => {
      if (!controller.signal.aborted) setResult({ status: "error", branches: [], error: error.message });
    });
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    if (result.status !== "ready" || !/^#(?:colombo|kandy|galle)$/.test(hash)) return;
    const card = document.getElementById(hash.slice(1));
    if (card) {
      card.scrollIntoView({ block: "start" });
      card.focus({ preventScroll: true });
    }
  }, [hash, result]);

  function retry() {
    setResult({ status: "loading", branches: [], error: "" });
    setAttempt((value) => value + 1);
  }

  const usedCities = new Set();

  return (
    <section className="sk-branches-page" aria-labelledby="sk-branches-title">
      <header className="sk-branches-intro">
        <div>
          <p className="sk-branches-eyebrow"><span aria-hidden="true" /> Our branches</p>
          <h1 id="sk-branches-title">A place for every<br /><em>kind of escape.</em></h1>
        </div>
        <p className="sk-branches-intro-copy">A different setting. A fresh perspective.<br />Explore our branches and find the starting point for your next stay.</p>
      </header>

      <div className="sk-branches-section-line">
        <p>Find your next SkyNest stay</p>
        {result.status === "ready" && <span>{String(result.branches.length).padStart(2, "0")} {result.branches.length === 1 ? "branch" : "branches"}</span>}
      </div>

      {result.status === "loading" && (
        <div className="sk-branches-loading" role="status">
          <p>Finding your next destination…</p>
          <div className="sk-branches-skeletons" aria-hidden="true"><span /><span /><span /></div>
        </div>
      )}

      {result.status === "error" && (
        <div className="sk-branches-message" role="alert">
          <h2>A moment before your next escape.</h2>
          <p>{result.error}</p>
          <button type="button" onClick={retry}>Try again <Arrow /></button>
        </div>
      )}

      {result.status === "ready" && result.branches.length === 0 && (
        <div className="sk-branches-message" role="status">
          <h2>More destinations to come.</h2>
          <p>There are no branches listed at the moment. Please check again soon.</p>
          <button type="button" onClick={retry}>Check again <Arrow /></button>
        </div>
      )}

      {result.status === "ready" && result.branches.length > 0 && (
        <div className="sk-branches-grid">
          {result.branches.map((branch, index) => {
            const destination = destinationFor(branch);
            const anchor = destination.city && !usedCities.has(destination.city) ? destination.city : `branch-${branch.id}`;
            if (destination.city) usedCities.add(destination.city);
            return <BranchCard key={branch.id} branch={branch} destination={destination} anchor={anchor} index={index} />;
          })}
        </div>
      )}

      <div className="sk-branches-closing">
        <p>Where will your next chapter begin?</p>
        <Link to="/rooms">Explore available rooms <Arrow /></Link>
      </div>
      <p className="sk-branches-photo-note">Hotel photographs are illustrative.</p>
    </section>
  );
}
