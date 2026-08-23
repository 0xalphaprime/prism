"use client";

import { use } from "react";
import { EvalHistoryItem } from "@/components/eval/eval-history-item";
import { SecondaryShell } from "@/components/shell/secondary-shell";

export default function EvalHistoryItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ item?: string }>;
}) {
  const { id } = use(params);
  return (
    <SecondaryShell title="Eval history">
      <EvalHistoryItem experimentId={id} searchParams={searchParams} />
    </SecondaryShell>
  );
}
