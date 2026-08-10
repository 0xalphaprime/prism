"use client";

import { use } from "react";
import { NodeOutputView } from "@/components/inspector/node-output-view";
import { SecondaryShell } from "@/components/shell/secondary-shell";

export default function NodeOutputPage({
  params,
}: {
  params: Promise<{ nodeId: string }>;
}) {
  const { nodeId } = use(params);

  return (
    <SecondaryShell title="Node output">
      <NodeOutputView nodeId={nodeId} />
    </SecondaryShell>
  );
}
