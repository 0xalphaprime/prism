import { BoardHome } from "@/components/board/board-home";
import { BoardShell } from "@/components/board/board-shell";

export default function BoardPage() {
  return (
    <BoardShell>
      <BoardHome />
    </BoardShell>
  );
}
