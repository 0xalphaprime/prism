"use client";

import { useGraphStore } from "@/store/graph-store";

export function TalkBar() {
  const talkDraft = useGraphStore((s) => s.talkDraft);
  const setTalkDraft = useGraphStore((s) => s.setTalkDraft);
  const applyTalkEdit = useGraphStore((s) => s.applyTalkEdit);
  const lastTalkMutation = useGraphStore((s) => s.lastTalkMutation);

  return (
    <div className="talk-bar">
      <form
        className="talk-form"
        onSubmit={(e) => {
          e.preventDefault();
          applyTalkEdit();
        }}
      >
        <label className="talk-label" htmlFor="talk-input">
          Talk
        </label>
        <input
          id="talk-input"
          value={talkDraft}
          onChange={(e) => setTalkDraft(e.target.value)}
          placeholder='Try “add a summarizer before the judge” or “use the cheaper model on research”'
        />
        <button type="submit" className="btn btn-accent">
          Apply
        </button>
      </form>
      {lastTalkMutation ? (
        <p
          className={`talk-feedback ${lastTalkMutation.applied ? "is-applied" : ""}`}
        >
          {lastTalkMutation.summary}
        </p>
      ) : (
        <p className="talk-feedback">Natural-language edits land on the same graph.</p>
      )}
    </div>
  );
}
