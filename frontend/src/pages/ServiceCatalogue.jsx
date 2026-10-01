import { useState } from "react";
import {
  demoServiceCategories,
  demoServices,
} from "../data/demoServices";

const money = new Intl.NumberFormat("en-LK", {
  style: "currency",
  currency: "LKR",
  currencyDisplay: "code",
});

export default function ServiceCatalogue() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");

  const query = search.trim().toLowerCase();

  const matchingServices = demoServices.filter((service) => {
    const matchesCategory =
      category === "" || service.category === category;

    const searchableText =
      `${service.name} ${service.description} ${service.category}`
        .toLowerCase();

    const matchesSearch = searchableText.includes(query);

    return matchesCategory && matchesSearch;
  });

  function clearFilters() {
    setSearch("");
    setCategory("");
  }

  return (
    <section aria-labelledby="services-heading">
      <p className="eyebrow">DURING YOUR STAY</p>
      <h1 id="services-heading">Guest services</h1>

      <p>Explore dining, spa, laundry and minibar options.</p>

      <p className="service-notice">
        Preview catalogue: these are sample services and prices.
        Service requests are not available in this preview.
      </p>

      <div className="service-filters">
        <div className="form-field">
          <label htmlFor="service-search">Search services</label>
          <input
            id="service-search"
            type="search"
            placeholder="For example, breakfast or laundry"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="form-field">
          <label htmlFor="service-category">Category</label>
          <select
            id="service-category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="">All categories</option>

            {demoServiceCategories.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <button
          className="button"
          type="button"
          onClick={clearFilters}
          disabled={search === "" && category === ""}
        >
          Clear filters
        </button>
      </div>

      <p className="service-count" role="status">
        {matchingServices.length} sample{" "}
        {matchingServices.length === 1 ? "service" : "services"} found.
      </p>

      {matchingServices.length === 0 ? (
        <p>
          No sample services match your search. Try another
          search term or category.
        </p>
      ) : (
        <div className="card-grid">
          {matchingServices.map((service) => (
            <article className="card service-card" key={service.id}>
              <p className="eyebrow">{service.category}</p>

              <h2>{service.name}</h2>

              <p className="service-description">
                {service.description}
              </p>

              <p className="service-price">
                <strong>{money.format(service.unitPrice)}</strong>
                <span>per {service.unit}</span>
              </p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}