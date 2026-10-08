import { Component } from "react";
import { Link, useLocation } from "react-router";
import "./PageStatus.css";

class RouteErrorBoundary extends Component {
  state = { failed: false, resetKeys: this.props.resetKeys };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  static getDerivedStateFromProps(props, state) {
    if (props.resetKeys.some((value, index) => value !== state.resetKeys[index])) {
      return { failed: false, resetKeys: props.resetKeys };
    }
    return null;
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="page-status" aria-labelledby="page-error-title">
        <span className="page-status-mark" aria-hidden="true">S</span>
        <p className="page-status-eyebrow">SKYNEST HOTELS</p>
        <h1 id="page-error-title">We couldn’t display this page</h1>
        <p className="page-status-copy" role="alert">
          Check your connection and refresh the page, or return to the home page.
        </p>
        <p className="page-status-note">
          If you were saving a booking, payment or service, check its history before submitting again.
        </p>
        <div className="page-status-actions">
          <button className="page-status-button" type="button" onClick={() => window.location.reload()}>
            Refresh page
          </button>
          <Link className="page-status-button page-status-button--outline" to="/">Return home</Link>
        </div>
      </section>
    );
  }
}

export default function PageBoundary({ guestToken, staffToken, children }) {
  const { key, pathname, search } = useLocation();
  const staffPage = pathname === "/staff" || pathname.startsWith("/staff/");
  const guestPage = pathname === "/guest" || pathname.startsWith("/guest/") || pathname === "/make-booking";
  const activeToken = staffPage ? staffToken : guestPage ? guestToken : null;

  // Clear a caught error on navigation/account change. Never key/remount healthy
  // routes: booking confirmation replaces history state immediately before POST.
  return (
    <RouteErrorBoundary resetKeys={[key, pathname, search, activeToken]}>
      {children}
    </RouteErrorBoundary>
  );
}
