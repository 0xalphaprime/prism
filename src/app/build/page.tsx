import { BuilderWorkspace } from "@/components/builder/builder-workspace";
import { SecondaryShell } from "@/components/shell/secondary-shell";

export default function BuildPage() {
  return (
    <SecondaryShell title="Builder">
      <BuilderWorkspace />
    </SecondaryShell>
  );
}
