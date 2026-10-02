import { demoBookings } from "./demoBookings";

const sampleGuestNames = {
  "DEMO-1001": "Sample guest A",
  "DEMO-1002": "Sample guest B",
  "DEMO-1003": "Sample guest C",
  "DEMO-1004": "Sample guest D",
};

export const demoStaffBookings = demoBookings.map((booking) => ({
  ...booking,
  guestName: sampleGuestNames[booking.reference] ?? "Sample guest",
}));