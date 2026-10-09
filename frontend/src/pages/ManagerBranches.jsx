import PropertyCatalogue from "../components/PropertyCatalogue";

export default function ManagerBranches({ session }) {
  return <PropertyCatalogue kind="branches" session={session} />;
}
