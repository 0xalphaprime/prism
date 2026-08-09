import { PromptEditor } from "@/components/shell/prompt-editor";
import { SecondaryShell } from "@/components/shell/secondary-shell";

export default function PromptPage() {
  return (
    <SecondaryShell title="Prompt">
      <PromptEditor />
    </SecondaryShell>
  );
}
