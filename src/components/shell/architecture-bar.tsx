"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import type { StudentLabSeed } from "@/lib/student-lab";
import { TEMPLATES } from "@/lib/templates";
import { useGraphStore } from "@/store/graph-store";

export function ArchitectureBar() {
  const hydrate = useGraphStore((s) => s.hydrate);
  const hydrated = useGraphStore((s) => s.hydrated);
  const dirty = useGraphStore((s) => s.dirty);
  const architectures = useGraphStore((s) => s.architectures);
  const activeId = useGraphStore((s) => s.activeId);
  const selectArchitecture = useGraphStore((s) => s.selectArchitecture);
  const cycleArchitecture = useGraphStore((s) => s.cycleArchitecture);
  const renameArchitecture = useGraphStore((s) => s.renameArchitecture);
  const saveArchitecture = useGraphStore((s) => s.saveArchitecture);
  const saveArchitectureAs = useGraphStore((s) => s.saveArchitectureAs);
  const createArchitecture = useGraphStore((s) => s.createArchitecture);
  const createFromTemplate = useGraphStore((s) => s.createFromTemplate);
  const duplicateArchitecture = useGraphStore((s) => s.duplicateArchitecture);
  const deleteArchitecture = useGraphStore((s) => s.deleteArchitecture);
  const exportActiveArchitecture = useGraphStore((s) => s.exportActiveArchitecture);
  const importArchitectureJson = useGraphStore((s) => s.importArchitectureJson);
  const setArchitectureMeta = useGraphStore((s) => s.setArchitectureMeta);
  const openStudentTeachers = useGraphStore((s) => s.openStudentTeachers);
  const applyLabSeed = useGraphStore((s) => s.applyLabSeed);
  const fileRef = useRef<HTMLInputElement>(null);
  const moreRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!hydrated) return;
    const empty = useGraphStore.getState().nodes.length === 0;
    let skip = false;
    try {
      skip = sessionStorage.getItem("prism-opened-student-lab-v2") === "1";
    } catch {
      skip = false;
    }
    if (skip && !empty) return;
    try {
      sessionStorage.setItem("prism-opened-student-lab-v2", "1");
    } catch {
      // still open this mount
    }
    openStudentTeachers();
  }, [hydrated, openStudentTeachers]);

  useEffect(() => {
    if (!hydrated) return;
    let tries = 0;
    let timer = 0;
    let cancelled = false;

    const pull = async () => {
      try {
        const res = await fetch("/api/lab/run-student");
        if (!res.ok) return false;
        const seed = (await res.json()) as StudentLabSeed;
        if (!seed?.id || cancelled) return false;
        applyLabSeed(seed);
        return true;
      } catch {
        return false;
      }
    };

    void pull().then((hit) => {
      if (hit || cancelled) return;
      timer = window.setInterval(() => {
        tries += 1;
        void pull().then((ok) => {
          if (ok || tries >= 48) window.clearInterval(timer);
        });
      }, 5000);
    });

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [hydrated, applyLabSeed]);

  useEffect(() => {
    if (!hydrated || !dirty) return;
    const timer = window.setTimeout(() => {
      saveArchitecture();
    }, 900);
    return () => window.clearTimeout(timer);
  }, [hydrated, dirty, architectures, saveArchitecture]);

  const active = useMemo(
    () => architectures.find((a) => a.id === activeId) ?? architectures[0],
    [architectures, activeId],
  );

  const closeMore = () => {
    if (moreRef.current) moreRef.current.open = false;
  };

  if (!active) return null;

  return (
    <div className="architecture-bar">
      <div className="architecture-row">
        <span className="architecture-label">Architecture</span>
        <div className="architecture-flip">
          <button
            type="button"
            className="btn btn-icon"
            onClick={() => cycleArchitecture(-1)}
            title="Previous architecture"
            disabled={architectures.length < 2}
          >
            ‹
          </button>
          <select
            className="architecture-select"
            value={active.id}
            onChange={(e) => selectArchitecture(e.target.value)}
          >
            {architectures.map((arch) => (
              <option key={arch.id} value={arch.id}>
                {arch.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-icon"
            onClick={() => cycleArchitecture(1)}
            title="Next architecture"
            disabled={architectures.length < 2}
          >
            ›
          </button>
        </div>

        <input
          className="architecture-name"
          value={active.name}
          onChange={(e) => renameArchitecture(e.target.value)}
          aria-label="Architecture name"
          title="Name this graph architecture"
        />

        <span className={`architecture-dirty ${dirty ? "is-dirty" : ""}`}>
          {dirty ? "Saving…" : "Saved"}
        </span>

        <button
          type="button"
          className="btn btn-accent"
          onClick={openStudentTeachers}
          title="Open Hub → Nemo + teachers → Judge → second Nemo"
        >
          Student vs teachers
        </button>

        <div className="architecture-actions">
          <Link href="/prompt" className="btn btn-accent">
            Prompt
          </Link>
          <Link href="/connections" className="btn">
            Connections
          </Link>
          <Link href="/context" className="btn btn-accent">
            Context
          </Link>
          <Link href="/trace" className="btn btn-accent">
            Trace ({active.runs.length})
          </Link>

          <details ref={moreRef} className="architecture-more">
            <summary className="btn">More</summary>
            <div className="architecture-more-menu">
              <Link href="/context/prefs" className="btn" onClick={closeMore}>
                Context prefs
              </Link>
              <select
                className="architecture-select template-select"
                defaultValue=""
                onChange={(e) => {
                  const id = e.target.value;
                  if (id) createFromTemplate(id);
                  e.target.value = "";
                  closeMore();
                }}
                aria-label="New from template"
              >
                <option value="" disabled>
                  Template…
                </option>
                {TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  saveArchitecture();
                  closeMore();
                }}
              >
                Save
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const name = window.prompt(
                    "Save architecture as:",
                    `${active.name} copy`,
                  );
                  if (name) saveArchitectureAs(name);
                  closeMore();
                }}
              >
                Save as
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const name = window.prompt(
                    "New architecture name:",
                    `Architecture ${architectures.length + 1}`,
                  );
                  if (name !== null) createArchitecture(name || undefined);
                  closeMore();
                }}
              >
                New
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  duplicateArchitecture();
                  closeMore();
                }}
              >
                Duplicate
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const json = exportActiveArchitecture();
                  if (!json) return;
                  const blob = new Blob([json], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${active.name.replace(/\s+/g, "-").toLowerCase()}.prism.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                  closeMore();
                }}
              >
                Export
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  closeMore();
                  fileRef.current?.click();
                }}
              >
                Import
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete architecture “${active.name}”? This cannot be undone.`,
                    )
                  ) {
                    deleteArchitecture();
                  }
                  closeMore();
                }}
              >
                Delete
              </button>
            </div>
          </details>

          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              const text = await file.text();
              importArchitectureJson(text);
            }}
          />
        </div>
      </div>

      <div className="architecture-row architecture-meta-row">
        <span className="architecture-label">Meta</span>
        <input
          className="architecture-name architecture-desc"
          value={active.description}
          onChange={(e) => setArchitectureMeta({ description: e.target.value })}
          placeholder="Short description for this pathway"
          aria-label="Architecture description"
        />
        <input
          className="architecture-name architecture-tags"
          value={active.tags.join(", ")}
          onChange={(e) =>
            setArchitectureMeta({
              tags: e.target.value
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean),
            })
          }
          placeholder="tags: moa, debate…"
          aria-label="Architecture tags"
        />
        <span className="architecture-owner" title="Owner (local identity)">
          {active.owner.name}
        </span>
      </div>
    </div>
  );
}
