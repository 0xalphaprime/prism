import { BoardShell } from "@/components/board/board-shell";
import { DecisionsWorkspace } from "@/components/board/decisions-workspace";

export default function BoardDecisionsPage() {
  return (
    <BoardShell>
      <DecisionsWorkspace />
    </BoardShell>
  );
}
