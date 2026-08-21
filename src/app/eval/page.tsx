import { EvalView } from "@/components/eval/eval-view";
import { SecondaryShell } from "@/components/shell/secondary-shell";

export default function EvalPage() {
  return (
    <SecondaryShell title="Eval Lab">
      <EvalView />
    </SecondaryShell>
  );
}
