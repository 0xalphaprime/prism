import { ContextPrefsWorkspace } from "@/components/shell/context-prefs-workspace";
import { SecondaryShell } from "@/components/shell/secondary-shell";

export default function ContextPrefsPage() {
  return (
    <SecondaryShell title="Context preferences">
      <ContextPrefsWorkspace />
    </SecondaryShell>
  );
}
