import { FeaturePlaceholder } from "../../components/page-shell";

/* Route: /eval. Not part of the Skills feature scope — a minimal stub so the
   SKILLS LAB nav link doesn't 404. */
export default function EvalPage() {
  return (
    <FeaturePlaceholder
      crumb={[{ label: "Eval Dashboard" }]}
      title="Eval Dashboard"
      icon="FlaskConical"
      owner="a future phase"
    />
  );
}
