import { EvalHistoryList } from "@/components/eval/eval-history-list";
import { SecondaryShell } from "@/components/shell/secondary-shell";

export default function EvalHistoryPage() {
  return (
    <SecondaryShell title="Eval history">
      <EvalHistoryList />
    </SecondaryShell>
  );
}
