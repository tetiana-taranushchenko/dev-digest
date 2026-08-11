import { FeaturePlaceholder } from "../../components/page-shell";

/* Route: /conventions. Not part of the Skills feature scope — a minimal stub
   so the SKILLS LAB nav link doesn't 404. */
export default function ConventionsPage() {
  return (
    <FeaturePlaceholder
      crumb={[{ label: "Conventions" }]}
      title="Conventions"
      icon="ListChecks"
      owner="a future phase"
    />
  );
}
