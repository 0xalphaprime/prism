"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { boardApi, errorText } from "@/components/board/board-api";
import { ModelSelect } from "@/components/board/model-select";
import { BLANK_DIRECTIVES, BLANK_PROFILE } from "@/lib/board/starters";
import type { Member, MemberSummary } from "@/lib/board/types";

type Form = {
  name: string;
  title: string;
  model: string;
  profile: string;
  directives: string;
  files: Array<{ name: string; content: string }>;
};

function toForm(member: Member): Form {
  return {
    name: member.name,
    title: member.title,
    model: member.model ?? "",
    profile: member.profile,
    directives: member.directives,
    files: member.files.map((f) => ({ name: f.name, content: f.content })),
  };
}

function normaliseFileName(raw: string): string | null {
  const base = raw.trim().toLowerCase().replace(/\.md$/, "").replace(/\s+/g, "-");
  const name = `${base}.md`;
  return /^[a-z0-9][a-z0-9-_]{0,63}\.md$/.test(name) ? name : null;
}

function count(text: string) {
  return `${text.length.toLocaleString()} characters`;
}

export function MembersWorkspace() {
  const [members, setMembers] = useState<MemberSummary[] | null>(null);
  const [dir, setDir] = useState("");
  const [loaded, setLoaded] = useState<Member | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newFileName, setNewFileName] = useState("");
  const [openFile, setOpenFile] = useState<string | null>(null);

  const dirty = useMemo(
    () => Boolean(loaded && form && JSON.stringify(toForm(loaded)) !== JSON.stringify(form)),
    [loaded, form],
  );

  const refreshList = useCallback(async () => {
    const data = await boardApi<{ members: MemberSummary[]; dir: string }>("/api/board/members");
    setMembers(data.members);
    setDir(data.dir);
    return data.members;
  }, []);

  const openMember = useCallback(async (slug: string) => {
    const data = await boardApi<{ member: Member }>(`/api/board/members/${slug}`);
    setLoaded(data.member);
    setForm(toForm(data.member));
    setOpenFile(null);
    setNewFileName("");
  }, []);

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      try {
        const list = await refreshList();
        if (cancelled) return;
        const wanted = new URLSearchParams(window.location.search).get("m");
        const first = list.find((m) => m.slug === wanted) ?? list[0];
        if (first) await openMember(first.slug);
      } catch (err) {
        if (!cancelled) setError(errorText(err));
      }
    };
    void boot();
    return () => {
      cancelled = true;
    };
  }, [refreshList, openMember]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  function okToLeave() {
    return !dirty || window.confirm(`Discard unsaved changes to ${loaded?.name ?? "this member"}?`);
  }

  function select(slug: string) {
    if (slug === loaded?.slug || !okToLeave()) return;
    void run(() => openMember(slug));
  }

  function patch(next: Partial<Form>) {
    setForm((current) => (current ? { ...current, ...next } : current));
  }

  function save() {
    if (!loaded || !form) return;
    const slug = loaded.slug;
    void run(async () => {
      await boardApi(`/api/board/members/${slug}`, {
        method: "PUT",
        body: {
          name: form.name,
          title: form.title,
          model: form.model,
          profile: form.profile,
          directives: form.directives,
        },
      });
      const before = new Map(loaded.files.map((f) => [f.name, f.content]));
      for (const file of form.files) {
        if (before.get(file.name) !== file.content) {
          await boardApi(`/api/board/members/${slug}/files/${file.name}`, {
            method: "PUT",
            body: { content: file.content },
          });
        }
      }
      for (const name of before.keys()) {
        if (!form.files.some((f) => f.name === name)) {
          await boardApi(`/api/board/members/${slug}/files/${name}`, { method: "DELETE" });
        }
      }
      await Promise.all([refreshList(), openMember(slug)]);
      setNotice("Saved.");
    });
  }

  function createNew() {
    if (!okToLeave()) return;
    void run(async () => {
      const data = await boardApi<{ member: Member }>("/api/board/members", {
        method: "POST",
        body: {
          name: "New member",
          title: "",
          profile: BLANK_PROFILE,
          directives: BLANK_DIRECTIVES,
        },
      });
      await refreshList();
      await openMember(data.member.slug);
      setNotice("New member created. Give it a name and write its profile.");
    });
  }

  function duplicate() {
    if (!loaded || !okToLeave()) return;
    void run(async () => {
      const data = await boardApi<{ member: Member }>("/api/board/members", {
        method: "POST",
        body: { duplicateOf: loaded.slug },
      });
      await refreshList();
      await openMember(data.member.slug);
      setNotice(`Copied to ${data.member.name}.`);
    });
  }

  function remove() {
    if (!loaded) return;
    const ok = window.confirm(
      `Remove ${loaded.name}? The folder is moved to members/.trash, not erased.`,
    );
    if (!ok) return;
    void run(async () => {
      await boardApi(`/api/board/members/${loaded.slug}`, { method: "DELETE" });
      const list = await refreshList();
      if (list[0]) await openMember(list[0].slug);
      else {
        setLoaded(null);
        setForm(null);
      }
      setNotice("Member moved to the trash folder.");
    });
  }

  function reload() {
    if (!loaded || !okToLeave()) return;
    void run(async () => {
      await Promise.all([refreshList(), openMember(loaded.slug)]);
      setNotice("Reloaded from disk.");
    });
  }

  function restoreStarters() {
    void run(async () => {
      const data = await boardApi<{ added: string[] }>("/api/board/members", {
        method: "POST",
        body: { restoreStarters: true },
      });
      const list = await refreshList();
      if (!loaded && list[0]) await openMember(list[0].slug);
      setNotice(
        data.added.length
          ? `Added ${data.added.length} starter member${data.added.length === 1 ? "" : "s"}.`
          : "All four starter members are already here.",
      );
    });
  }

  function addFile() {
    if (!form) return;
    const name = normaliseFileName(newFileName);
    if (!name) {
      setError("File names use letters, numbers, dashes and underscores.");
      return;
    }
    if (form.files.some((f) => f.name === name)) {
      setError(`${name} already exists.`);
      return;
    }
    setError(null);
    patch({ files: [...form.files, { name, content: "" }].sort((a, b) => a.name.localeCompare(b.name)) });
    setOpenFile(name);
    setNewFileName("");
  }

  return (
    <section className="page-workspace board-workspace">
      <header className="page-workspace-header">
        <div>
          <p className="sheet-kicker">Board</p>
          <h1>Members</h1>
          <p className="sheet-help">
            Every member reads the same material. What differs is who is reading it: the
            profile shapes how they interpret it, and the research directives decide where
            they go looking.
          </p>
        </div>
        <div className="board-actions">
          <button type="button" className="btn btn-accent" onClick={createNew} disabled={busy}>
            New member
          </button>
          <button type="button" className="btn" onClick={restoreStarters} disabled={busy}>
            Restore starters
          </button>
        </div>
      </header>

      {error ? (
        <p className="board-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? <p className="board-notice">{notice}</p> : null}

      <div className="board-members">
        <aside className="board-member-list" aria-label="Members">
          {members === null ? <p className="sheet-help">Loading members…</p> : null}
          {members?.length === 0 ? (
            <p className="sheet-help">No members yet. Create one, or restore the starters.</p>
          ) : null}
          {members?.map((m) => (
            <button
              key={m.slug}
              type="button"
              className={`board-member-item${m.slug === loaded?.slug ? " is-active" : ""}`}
              onClick={() => select(m.slug)}
            >
              <span className="board-member-name">{m.name}</span>
              <span className="board-member-title">{m.title || "No title yet"}</span>
              <span className="board-member-meta">
                Profile {m.profileChars.toLocaleString()} · Directives{" "}
                {m.directivesChars.toLocaleString()} · {m.fileCount} file
                {m.fileCount === 1 ? "" : "s"}
              </span>
            </button>
          ))}
          {dir ? (
            <p className="board-path" title={dir}>
              On disk: <code>{dir}</code>
            </p>
          ) : null}
        </aside>

        {loaded && form ? (
          <div className="board-member-editor">
            <div className="board-editor-bar">
              <span className={`board-dirty${dirty ? " is-dirty" : ""}`}>
                {dirty ? "Unsaved changes" : "Saved"}
              </span>
              <div className="board-actions">
                <button type="button" className="btn" onClick={reload} disabled={busy}>
                  Reload from disk
                </button>
                <button type="button" className="btn" onClick={duplicate} disabled={busy}>
                  Duplicate
                </button>
                <button type="button" className="btn" onClick={remove} disabled={busy}>
                  Remove
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={save}
                  disabled={busy || !dirty}
                >
                  Save
                </button>
              </div>
            </div>

            <div className="board-field-row">
              <label className="field">
                <span>Name</span>
                <input
                  value={form.name}
                  onChange={(e) => patch({ name: e.target.value })}
                  maxLength={80}
                />
              </label>
              <label className="field board-field-wide">
                <span>Accountable for</span>
                <input
                  value={form.title}
                  onChange={(e) => patch({ title: e.target.value })}
                  maxLength={240}
                  placeholder="One line: what this member answers for"
                />
              </label>
            </div>

            <label className="field">
              <span>Profile</span>
              <textarea
                className="board-textarea board-textarea-tall"
                value={form.profile}
                onChange={(e) => patch({ profile: e.target.value })}
                spellCheck
              />
              <small className="field-hint">
                Who this member is: experience, beliefs, how they weigh evidence, and what they
                tend to miss. Concrete rules change answers; a job title alone does not.{" "}
                {count(form.profile)}.
              </small>
            </label>

            <label className="field">
              <span>Research directives</span>
              <textarea
                className="board-textarea"
                value={form.directives}
                onChange={(e) => patch({ directives: e.target.value })}
                spellCheck
              />
              <small className="field-hint">
                Where this member goes looking: the questions they always chase, the sources they
                trust and distrust, how recent, and what would prove them wrong.{" "}
                {count(form.directives)}.
              </small>
            </label>

            <div className="board-files">
              <div className="board-files-head">
                <h2>Living files</h2>
                <p className="sheet-help">
                  Notes that change over time, such as lessons from past decisions. The member
                  reads all of them.
                </p>
              </div>
              {form.files.length === 0 ? (
                <p className="sheet-help">No files yet.</p>
              ) : null}
              {form.files.map((file) => (
                <details
                  key={file.name}
                  className="board-file"
                  open={openFile === file.name}
                  onToggle={(e) => {
                    const isOpen = (e.currentTarget as HTMLDetailsElement).open;
                    setOpenFile((current) =>
                      isOpen ? file.name : current === file.name ? null : current,
                    );
                  }}
                >
                  <summary>
                    <span className="board-file-name">{file.name}</span>
                    <span className="board-member-meta">{count(file.content)}</span>
                  </summary>
                  <textarea
                    className="board-textarea"
                    aria-label={`Contents of ${file.name}`}
                    value={file.content}
                    onChange={(e) =>
                      patch({
                        files: form.files.map((f) =>
                          f.name === file.name ? { ...f, content: e.target.value } : f,
                        ),
                      })
                    }
                  />
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      if (!window.confirm(`Remove ${file.name}? This takes effect when you save.`)) return;
                      patch({ files: form.files.filter((f) => f.name !== file.name) });
                    }}
                  >
                    Remove file
                  </button>
                </details>
              ))}
              <div className="board-file-add">
                <input
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addFile();
                    }
                  }}
                  placeholder="New file name, for example past-bets"
                  aria-label="New file name"
                />
                <button
                  type="button"
                  className="btn"
                  onClick={addFile}
                  disabled={!newFileName.trim()}
                >
                  Add file
                </button>
              </div>
            </div>

            <label className="field">
              <span>Model</span>
              <ModelSelect
                value={form.model}
                onChange={(model) => patch({ model })}
                emptyLabel="Same as the rest of the board"
              />
              <small className="field-hint">
                Leave this alone unless you want this member on a different model from the others.
              </small>
            </label>

            <p className="board-path" title={`${dir}/${loaded.slug}`}>
              Folder: <code>{`${dir}/${loaded.slug}`}</code>. You can edit these files directly;
              use Reload from disk to pick up the changes.
            </p>
          </div>
        ) : members && members.length > 0 ? (
          <p className="sheet-help">Loading member…</p>
        ) : null}
      </div>
    </section>
  );
}
