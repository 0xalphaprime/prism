"use client";

import { CONTEXT_SOURCE_OPTIONS } from "@/lib/context-sources";
import { useGraphStore } from "@/store/graph-store";

export function ContextPrefsWorkspace() {
  const catalog = useGraphStore((s) => s.contextCatalog);
  const toggleCatalogKind = useGraphStore((s) => s.toggleCatalogKind);

  return (
    <section className="page-workspace">
      <header className="page-workspace-header">
        <div>
          <p className="sheet-kicker">Context preferences</p>
          <h1>Your channel catalog</h1>
          <p className="sheet-help">
            Choose which channel types show up in Add tile and the context
            workspace. Connection status still decides whether intake works.
          </p>
        </div>
      </header>

      <ul className="context-prefs-list">
        {CONTEXT_SOURCE_OPTIONS.map((option) => {
          const on = catalog.enabledKinds.includes(option.kind);
          return (
            <li key={option.kind}>
              <label className={`context-prefs-row ${on ? "is-on" : ""}`}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggleCatalogKind(option.kind)}
                />
                <span>
                  <strong>{option.label}</strong>
                  <em>{option.hint}</em>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
