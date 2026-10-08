import { useEffect, useState } from "react";
import { Link } from "react-router";
import { loadServiceCatalogue } from "../services/serviceCatalogueApi";
import "./ServiceCatalogue.css";

const money = new Intl.NumberFormat("en-LK", {
  style: "currency",
  currency: "LKR",
  currencyDisplay: "code",
});

function serviceImage(name) {
  if (/dining|restaurant|food|breakfast|lunch|dinner/i.test(name)) {
    return "/images/hotel/service-dining.jpg";
  }
  if (/spa|massage|wellness/i.test(name)) {
    return "/images/hotel/service-spa.jpg";
  }
  return null;
}

function ServiceBell({ className }) {
  return (
    <svg className={className} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <path d="M10 43h44M15 43v-3a17 17 0 0 1 34 0v3M8 50h48M32 23v-7M27 16h10" />
      <path d="M21 36a12 12 0 0 1 6-7" />
    </svg>
  );
}

function ServiceMark({ name }) {
  let drawing;
  if (/room\s*service/i.test(name)) {
    drawing = (
      <>
        <circle cx="33" cy="32" r="13" />
        <circle cx="33" cy="32" r="9" />
        <path d="M11 17v10a4 4 0 0 0 8 0V17M15 17v31M54 48V17c-5 4-6 10-6 17h6" />
      </>
    );
  } else if (/laundry/i.test(name)) {
    drawing = (
      <>
        <path d="M15 21h34a6 6 0 0 1 0 12H15a6 6 0 0 1 0-12ZM15 27h30M13 33h35a6 6 0 0 1 0 12H13a6 6 0 0 1 0-12ZM14 39h29M11 45h40" />
        <path d="M25 21v12M37 33v12" />
      </>
    );
  } else if (/mini\s*bar/i.test(name)) {
    drawing = (
      <>
        <path d="M17 12h10v5H17zM18 17v8c0 3-5 5-5 10v16h18V35c0-5-5-7-5-10v-8M13 36h18M13 45h18" />
        <path d="M39 27h14l-2 13a5 5 0 0 1-10 0l-2-13ZM40 34h12M46 45v8M41 53h10" />
      </>
    );
  } else {
    return <ServiceBell className="service-catalogue-bell" />;
  }

  return (
    <svg className="service-catalogue-service-icon" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      {drawing}
    </svg>
  );
}

export default function ServiceCatalogue() {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    loadServiceCatalogue(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setServices(data);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [attempt]);

  const query = search.trim().toLowerCase();
  const matchingServices = services.filter((service) =>
    `${service.ServiceName} ${service.Description ?? ""}`
      .toLowerCase()
      .includes(query),
  );

  function retry() {
    setLoading(true);
    setError("");
    setAttempt((current) => current + 1);
  }

  return (
    <section className="service-catalogue-page" aria-labelledby="services-heading" aria-busy={loading}>
      <header className="service-catalogue-intro">
        <div>
          <p className="eyebrow">THE DETAILS OF A GOOD STAY</p>
          <h1 id="services-heading">Guest services<span>.</span></h1>
          <p className="service-catalogue-lead">A little more comfort. A little more you.</p>
          <p className="service-catalogue-summary">Explore our available services and current prices.</p>
        </div>
        <aside className="service-catalogue-assistance" aria-label="Arranging a service">
          <ServiceBell className="service-catalogue-bell" />
          <div>
            <p className="service-catalogue-small-label">AT YOUR SERVICE</p>
            <p>Already checked in? Choose your stay to request a service, or speak with reception.</p>
            <Link className="service-catalogue-request-link" to="/guest/bookings">Go to My bookings <span aria-hidden="true">→</span></Link>
          </div>
        </aside>
      </header>

      <div className="service-filters">
        <div className="form-field">
          <label htmlFor="service-search">Search services</label>
          <div className="service-search-input">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="m16 16 4 4" />
            </svg>
            <input
              id="service-search"
              type="search"
              placeholder="Search by name or description"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>

        <button
          className="button"
          type="button"
          onClick={() => setSearch("")}
          disabled={search === ""}
        >
          Clear search
        </button>
      </div>

      {loading ? (
        <p className="service-catalogue-state" role="status">Loading services…</p>
      ) : error ? (
        <div className="service-notice service-catalogue-state">
          <p role="alert">{error}</p>
          <button className="button" type="button" onClick={retry}>
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="service-catalogue-results-heading">
            <h2>Consider your stay, enhanced.</h2>
            <p className="service-count" role="status">
              {matchingServices.length}{" "}
              {matchingServices.length === 1 ? "service" : "services"} found.
            </p>
          </div>
          {services.length === 0 ? (
            <p className="service-catalogue-state">No services are available in the catalogue right now. Please ask staff for assistance.</p>
          ) : matchingServices.length === 0 ? (
            <p className="service-catalogue-state">No services match your search. Try another search term or clear your search.</p>
          ) : (
            <>
              <div className="card-grid">
                {matchingServices.map((service) => {
                  const image = serviceImage(service.ServiceName);
                  return (
                    <article className="card service-card" key={service.ServiceID}>
                      <div className={`service-catalogue-media${image ? "" : " service-catalogue-media--graphic"}`}>
                        {image ? (
                          <img src={image} alt="" loading="lazy" />
                        ) : (
                          <div className="service-catalogue-service-mark">
                            <ServiceMark name={service.ServiceName} />
                          </div>
                        )}
                        <span className="service-catalogue-media-label">DURING YOUR STAY</span>
                      </div>
                      <div className="service-catalogue-card-body">
                        <h3>{service.ServiceName}</h3>
                        {service.Description && (
                          <p className="service-description">{service.Description}</p>
                        )}
                        <p className="service-price">
                          <span>Service price</span>
                          <strong>{money.format(service.UnitPrice)}</strong>
                        </p>
                      </div>
                    </article>
                  );
                })}
              </div>
              {matchingServices.some((service) => serviceImage(service.ServiceName)) && (
                <p className="service-catalogue-photo-note">Photography is illustrative; please refer to each service description for details.</p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
