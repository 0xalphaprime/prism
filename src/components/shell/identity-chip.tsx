"use client";

import { useGraphStore } from "@/store/graph-store";

export function IdentityChip() {
  const user = useGraphStore((s) => s.user);
  const hydrated = useGraphStore((s) => s.hydrated);
  const renameLocalUser = useGraphStore((s) => s.renameLocalUser);
  const title = hydrated
    ? `Last active ${new Date(user.updatedAt).toLocaleString()}`
    : "Signed in";

  return (
    <div className="identity-chip" title={title}>
      <span className="identity-kicker">Signed in</span>
      <input
        className="identity-name"
        value={user.name}
        onChange={(e) => renameLocalUser(e.target.value)}
        aria-label="Display name"
      />
    </div>
  );
}
