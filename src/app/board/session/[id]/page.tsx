import { BoardShell } from "@/components/board/board-shell";
import { SessionWorkspace } from "@/components/board/session-workspace";

export default async function BoardSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <BoardShell>
      <SessionWorkspace id={id} />
    </BoardShell>
  );
}
