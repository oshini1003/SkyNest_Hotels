import PropertyCatalogue from "../components/PropertyCatalogue";

export default function ManagerRoomTypes({ session }) {
  return <PropertyCatalogue kind="room-types" session={session} />;
}
