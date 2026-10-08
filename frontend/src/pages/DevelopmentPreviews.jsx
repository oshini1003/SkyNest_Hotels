import GuestBookings from "./GuestBookings";
import StaffBookings from "./StaffBookings";
import { demoBookings } from "../data/demoBookings";
import { demoStaffBookings } from "../data/demoStaffBookings";

export { default as ServiceUsagePreview } from "./ServiceUsagePreview";
export { default as StaffBillDetails } from "./StaffBillDetails";
export { default as StaffPayment } from "./StaffPayment";
export { default as ManagerReportsPreview } from "./ManagerReportsPreview";

export function GuestBookingsPreview() {
  return <GuestBookings bookings={demoBookings} isPreview={true} />;
}

export function StaffBookingsPreview() {
  return <StaffBookings bookings={demoStaffBookings} isPreview={true} />;
}
