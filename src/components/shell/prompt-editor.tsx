"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useGraphStore } from "@/store/graph-store";

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function PromptEditor() {
  const architectures = useGraphStore((s) => s.architectures);
  const activeId = useGraphStore((s) => s.activeId);
  const setArchitecturePrompt = useGraphStore((s) => s.setArchitecturePrompt);

  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const basePromptRef = useRef("");

  const active = useMemo(
    () => architectures.find((a) => a.id === activeId) ?? architectures[0],
    [architectures, activeId],
  );

  const speechAvailable = Boolean(getSpeechRecognition());

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  if (!active) return null;

  function stopListening() {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
  }

  function toggleVoice() {
    const Ctor = getSpeechRecognition();
    if (!Ctor) return;

    if (listening) {
      stopListening();
      return;
    }

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    basePromptRef.current = active?.prompt ?? "";

    recognition.onresult = (event) => {
      const chunks: string[] = [];
      for (let i = 0; i < event.results.length; i += 1) {
        chunks.push(event.results[i][0]?.transcript ?? "");
      }
      const spoken = chunks.join(" ").trim();
      const merged = [basePromptRef.current.trim(), spoken]
        .filter(Boolean)
        .join(basePromptRef.current.trim() ? " " : "");
      setArchitecturePrompt(merged);
    };
    recognition.onerror = () => stopListening();
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }

  return (
    <section className="page-workspace prompt-workspace">
      <header className="page-workspace-header">
        <div>
          <p className="sheet-kicker">Prompt</p>
          <h1>Run intent for {active.name}</h1>
          <p className="sheet-help">
            Type or dictate what this architecture should run. This is the
            execution prompt for Step / Run all.
          </p>
        </div>
      </header>

      <textarea
        className="prompt-panel-input prompt-workspace-input"
        rows={12}
        value={active.prompt}
        onChange={(e) => setArchitecturePrompt(e.target.value)}
        placeholder="Describe the task to run through this graph…"
        autoFocus
      />

      <div className="prompt-panel-actions">
        <button
          type="button"
          className={`btn ${listening ? "btn-primary" : "btn-accent"}`}
          onClick={toggleVoice}
          disabled={!speechAvailable}
          title={
            speechAvailable
              ? listening
                ? "Stop listening"
                : "Dictate prompt"
              : "Voice input not supported in this browser"
          }
        >
          {listening ? "Stop voice" : "Voice"}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => setArchitecturePrompt("")}
          disabled={!active.prompt}
        >
          Clear
        </button>
      </div>
    </section>
  );
}
