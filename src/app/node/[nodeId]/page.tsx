"use client";

import { use } from "react";
import { NodeWorkspace } from "@/components/inspector/node-workspace";
import { SecondaryShell } from "@/components/shell/secondary-shell";

export default function NodePage({
  params,
}: {
  params: Promise<{ nodeId: string }>;
}) {
  const { nodeId } = use(params);

  return (
    <SecondaryShell title="Node workspace">
      <NodeWorkspace nodeId={nodeId} />
    </SecondaryShell>
  );
}
