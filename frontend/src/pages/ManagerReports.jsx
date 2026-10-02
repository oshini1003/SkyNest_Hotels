import { useState } from "react";
import { Link } from "react-router";

export default function ManagerReports() {
  const occupancyData = [
    { branch: "Colombo", totalRooms: 50, occupied: 42, occupancyRate: "84%" },
    { branch: "Kandy", totalRooms: 30, occupied: 21, occupancyRate: "70%" },
    { branch: "Galle", totalRooms: 40, occupied: 35, occupancyRate: "87.5%" }
  ];

  const [bills] = useState([
    { id: "SKN-8492", guest: "Lakshan Gamage", branch: "Colombo", total: 14500, paid: 10000, status: "Outstanding" },
    { id: "SKN-8493", guest: "Kasun Perera", branch: "Kandy", total: 22000, paid: 22000, status: "Paid" },
    { id: "SKN-8494", guest: "Nimesha Silva", branch: "Galle", total: 18500, paid: 5000, status: "Outstanding" },
    { id: "SKN-8495", guest: "Amal Fernando", branch: "Colombo", total: 30000, paid: 30000, status: "Paid" }
  ]);

  const [filterOutstanding, setFilterOutstanding] = useState(false);

  const filteredBills = filterOutstanding
    ? bills.filter(b => b.status === "Outstanding")
    : bills;

  return (
    <section>
      <p className="eyebrow">MANAGER PORTAL</p>
      <h1>Manager Reports & Analytics</h1>

      {/* Branch Occupancy Section */}
      <div style={{ background: "#fdfbf7", padding: "2rem", borderRadius: "8px", border: "1px solid #e2d9cc", marginTop: "1.5rem" }}>
        <h2>Branch Occupancy Summary</h2>
        <table style={{ width: "100%", marginTop: "1rem", borderCollapse: "collapse", textAlign: "left" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #e2d9cc" }}>
              <th style={{ padding: "10px" }}>Branch</th>
              <th style={{ padding: "10px" }}>Total Rooms</th>
              <th style={{ padding: "10px" }}>Occupied Rooms</th>
              <th style={{ padding: "10px" }}>Occupancy Rate</th>
            </tr>
          </thead>
          <tbody>
            {occupancyData.map((item, index) => (
              <tr key={index} style={{ borderBottom: "1px solid #e2d9cc" }}>
                <td style={{ padding: "10px" }}>{item.branch}</td>
                <td style={{ padding: "10px" }}>{item.totalRooms}</td>
                <td style={{ padding: "10px" }}>{item.occupied}</td>
                <td style={{ padding: "10px", fontWeight: "bold" }}>{item.occupancyRate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Billing Summary Section */}
      <div style={{ background: "#fdfbf7", padding: "2rem", borderRadius: "8px", border: "1px solid #e2d9cc", marginTop: "2rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
          <h2>Billing Summary & Invoices</h2>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontWeight: "bold" }}>
            <input
              type="checkbox"
              checked={filterOutstanding}
              onChange={(e) => setFilterOutstanding(e.target.checked)}
              style={{ width: "18px", height: "18px" }}
            />
            Show Outstanding Bills Only
          </label>
        </div>

        <table style={{ width: "100%", marginTop: "1rem", borderCollapse: "collapse", textAlign: "left" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #e2d9cc" }}>
              <th style={{ padding: "10px" }}>Booking ID</th>
              <th style={{ padding: "10px" }}>Guest Name</th>
              <th style={{ padding: "10px" }}>Branch</th>
              <th style={{ padding: "10px" }}>Total (LKR)</th>
              <th style={{ padding: "10px" }}>Paid (LKR)</th>
              <th style={{ padding: "10px" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredBills.map((bill) => (
              <tr key={bill.id} style={{ borderBottom: "1px solid #e2d9cc" }}>
                <td style={{ padding: "10px" }}>{bill.id}</td>
                <td style={{ padding: "10px" }}>{bill.guest}</td>
                <td style={{ padding: "10px" }}>{bill.branch}</td>
                <td style={{ padding: "10px" }}>LKR {bill.total.toLocaleString()}.00</td>
                <td style={{ padding: "10px" }}>LKR {bill.paid.toLocaleString()}.00</td>
                <td style={{ padding: "10px" }}>
                  <span style={{ color: bill.status === "Outstanding" ? "red" : "green", fontWeight: "bold" }}>
                    {bill.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ marginTop: "2rem", display: "flex", gap: "1rem" }}>
          <Link className="button" style={{ background: "#6c757d" }} to="/staff/bill-details">
            Back to Bill Details
          </Link>
        </div>
      </div>
    </section>
  );
}