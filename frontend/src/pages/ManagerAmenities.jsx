import PropertyInventory from "../components/PropertyInventory";

export default function ManagerAmenities({ session }) {
  return <PropertyInventory kind="amenities" session={session} />;
}
