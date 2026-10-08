import "./PageStatus.css";

export default function PageLoading() {
  return (
    <section className="page-status" role="status" aria-live="polite">
      <span className="page-status-mark" aria-hidden="true">S</span>
      <p className="page-status-eyebrow">SKYNEST HOTELS</p>
      <h1>Opening your page</h1>
      <p className="page-status-copy">Just a moment while we get everything ready.</p>
      <span className="page-status-line" aria-hidden="true" />
    </section>
  );
}
