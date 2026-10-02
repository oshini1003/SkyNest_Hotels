export const demoBookings = [
  {
    reference: "DEMO-1001",
    branch: "Colombo",
    checkin: "2026-10-15",
    checkout: "2026-10-17",
    guests: 4,
    status: "Booked",
    rooms: [
      { number: "101", roomType: "Standard" },
      { number: "201", roomType: "Deluxe" },
    ],
  },
  {
    reference: "DEMO-1002",
    branch: "Kandy",
    checkin: "2026-09-27",
    checkout: "2026-09-29",
    guests: 2,
    status: "Checked-In",
    rooms: [
      { number: "101", roomType: "Standard" },
    ],
  },
  {
    reference: "DEMO-1003",
    branch: "Galle",
    checkin: "2026-09-20",
    checkout: "2026-09-22",
    guests: 3,
    status: "Checked-Out",
    rooms: [
      { number: "301", roomType: "Suite" },
    ],
  },
  {
    reference: "DEMO-1004",
    branch: "Colombo",
    checkin: "2026-10-05",
    checkout: "2026-10-07",
    guests: 2,
    status: "Cancelled",
    rooms: [
      { number: "201", roomType: "Deluxe" },
    ],
  },
];