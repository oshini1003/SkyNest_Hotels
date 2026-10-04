import { useState } from "react";
import { Link } from "react-router";
import { demoBillingSummary, demoOccupancy, formatLkr } from "../data/demoBilling";

export default function ManagerReportsPreview() {
  const [filterOutstanding, setFilterOutstanding] = useState(false);
  const filteredBills = filterOutstanding
    ? demoBillingSummary.filter((bill) => bill.total > bill.paid)
    : demoBillingSummary;

  return (
    <section>
      <p className="eyebrow">MANAGER REPORTS PREVIEW</p>
      <h1>Sample manager reports</h1>
      <p className="booking-notice">
        Development preview using fictional figures. These are not live hotel
        reports. Payment simulations do not update the figures below.
      </p>

      <h2>Sample branch occupancy</h2>
      <div className="staff-booking-table-wrap" tabIndex={0} role="region" aria-label="Sample occupancy table">
        <table className="staff-booking-table" style={{ minWidth: "550px" }}>
          <caption>Fictional room counts for the report layout</caption>
          <thead>
            <tr>
              <th scope="col">Branch</th>
              <th scope="col">Total rooms</th>
              <th scope="col">Occupied rooms</th>
              <th scope="col">Occupancy rate</th>
            </tr>
          </thead>
          <tbody>
            {demoOccupancy.map((item) => (
              <tr key={item.branch}>
                <th scope="row">{item.branch}</th>
                <td>{item.totalRooms}</td>
                <td>{item.occupied}</td>
                <td>{((item.occupied / item.totalRooms) * 100).toLocaleString("en-LK", { maximumFractionDigits: 1 })}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={{ marginTop: "2rem" }}>Sample billing summary</h2>
      <label htmlFor="preview-outstanding-only" style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "1rem" }}>
        <input
          id="preview-outstanding-only"
          type="checkbox"
          checked={filterOutstanding}
          onChange={(event) => setFilterOutstanding(event.target.checked)}
        />
        Show outstanding sample bills only
      </label>
      <div className="staff-booking-table-wrap" tabIndex={0} role="region" aria-label="Sample billing table">
        <table className="staff-booking-table">
          <caption>{filteredBills.length} sample bills</caption>
          <thead>
            <tr>
              <th scope="col">Booking</th>
              <th scope="col">Guest</th>
              <th scope="col">Branch</th>
              <th scope="col">Total</th>
              <th scope="col">Paid</th>
              <th scope="col">Outstanding</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredBills.map((bill) => (
              <tr key={bill.id}>
                <th scope="row">{bill.id}</th>
                <td>{bill.guest}</td>
                <td>{bill.branch}</td>
                <td>{formatLkr(bill.total)}</td>
                <td>{formatLkr(bill.paid)}</td>
                <td>{formatLkr(bill.total - bill.paid)}</td>
                <td>{bill.total > bill.paid ? "Outstanding" : "Paid"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Link className="button" to="/preview/staff/bill-details" style={{ marginTop: "2rem" }}>
        View sample bill
      </Link>
    </section>
  );
}
