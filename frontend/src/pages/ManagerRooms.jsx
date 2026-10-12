import PropertyInventory from "../components/PropertyInventory";

export default function ManagerRooms({ session }) {
  return <PropertyInventory kind="rooms" session={session} />;
}
