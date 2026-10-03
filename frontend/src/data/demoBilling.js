// Fictional data shared by the development-only billing previews.
export const demoBill = {
  bookingId: "DEMO-8492",
  guestName: "Sample Guest",
  branch: "Colombo",
  roomType: "Double (Room 101)",
  roomCharges: 12000,
  serviceCharges: 2500,
  totalAmount: 14500,
  paymentsReceived: 10000,
  paymentHistory: [
    { id: "DEMO-PAY-01", date: "2026-10-06", method: "Card", amount: 10000 },
  ],
};

export const demoBillingSummary = [
  {
    id: demoBill.bookingId,
    guest: demoBill.guestName,
    branch: demoBill.branch,
    total: demoBill.totalAmount,
    paid: demoBill.paymentsReceived,
  },
  { id: "DEMO-8493", guest: "Sample Guest 2", branch: "Kandy", total: 22000, paid: 22000 },
  { id: "DEMO-8494", guest: "Sample Guest 3", branch: "Galle", total: 18500, paid: 5000 },
  { id: "DEMO-8495", guest: "Sample Guest 4", branch: "Colombo", total: 30000, paid: 30000 },
];

export const demoOccupancy = [
  { branch: "Colombo", totalRooms: 50, occupied: 42 },
  { branch: "Kandy", totalRooms: 30, occupied: 21 },
  { branch: "Galle", totalRooms: 40, occupied: 35 },
];

const amountFormatter = new Intl.NumberFormat("en-LK", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatLkr(amount) {
  return `LKR ${amountFormatter.format(amount)}`;
}
