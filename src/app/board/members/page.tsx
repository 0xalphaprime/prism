import { BoardShell } from "@/components/board/board-shell";
import { MembersWorkspace } from "@/components/board/members-workspace";

export default function BoardMembersPage() {
  return (
    <BoardShell>
      <MembersWorkspace />
    </BoardShell>
  );
}
