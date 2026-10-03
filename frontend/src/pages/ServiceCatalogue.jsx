import { useEffect, useState } from "react";
import { loadServiceCatalogue } from "../services/serviceCatalogueApi";

const money = new Intl.NumberFormat("en-LK", {
  style: "currency",
  currency: "LKR",
  currencyDisplay: "code",
});

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
    <section aria-labelledby="services-heading" aria-busy={loading}>
      <p className="eyebrow">DURING YOUR STAY</p>
      <h1 id="services-heading">Guest services</h1>

      <p>Explore our available services and current prices.</p>

      <p className="service-notice">
        Ask a member of staff to arrange a service during your stay.
      </p>

      <div className="service-filters">
        <div className="form-field">
          <label htmlFor="service-search">Search services</label>
          <input
            id="service-search"
            type="search"
            placeholder="Search by name or description"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
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
        <p className="service-count" role="status">Loading services…</p>
      ) : error ? (
        <div className="service-notice">
          <p role="alert">{error}</p>
          <button className="button" type="button" onClick={retry}>
            Retry
          </button>
        </div>
      ) : (
        <>
          <p className="service-count" role="status">
            {matchingServices.length}{" "}
            {matchingServices.length === 1 ? "service" : "services"} found.
          </p>
          {services.length === 0 ? (
            <p>No services are available in the catalogue right now. Please ask staff for assistance.</p>
          ) : matchingServices.length === 0 ? (
            <p>No services match your search. Try another search term or clear your search.</p>
          ) : (
            <div className="card-grid">
              {matchingServices.map((service) => (
                <article className="card service-card" key={service.ServiceID}>
                  <h2>{service.ServiceName}</h2>
                  {service.Description && (
                    <p className="service-description">{service.Description}</p>
                  )}
                  <p className="service-price">
                    <strong>{money.format(service.UnitPrice)}</strong>
                  </p>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
