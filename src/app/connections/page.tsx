import { ConnectionsWorkspace } from "@/components/shell/connections-workspace";
import { SecondaryShell } from "@/components/shell/secondary-shell";

export default function ConnectionsPage() {
  return (
    <SecondaryShell title="Connections">
      <ConnectionsWorkspace />
    </SecondaryShell>
  );
}
