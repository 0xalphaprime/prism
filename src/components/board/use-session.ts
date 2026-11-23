"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { boardApi, errorText } from "@/components/board/board-api";
import type { SessionMemberView, SessionView, StepStatus } from "@/lib/board/types";

export type StepRequest = { step: string; member: string; body?: Record<string, unknown> };

export type NextMove =
  | { kind: "run"; request: StepRequest }
  | { kind: "busy" }
  | { kind: "owner"; reason: string }
  | { kind: "stopped"; reason: string }
  | { kind: "finished" };

function finished(status: StepStatus) {
  return status === "done" || status === "skipped";
}

/** What should happen next for one member, read off the saved state. */
export function nextMove(member: SessionMemberView): NextMove {
  const { plan, research, notes } = member.state.steps;
  if ([plan, research, notes].some((s) => s.status === "running")) return { kind: "busy" };
  const run = (step: string): NextMove => ({ kind: "run", request: { step, member: member.slug } });

  if (plan.status === "error") return { kind: "stopped", reason: "The search plan failed" };
  if (plan.status === "idle") return run("plan");

  if (research.status === "error") return { kind: "stopped", reason: "Research failed" };
  if (research.status === "idle") {
    if (!member.plan?.approved) return { kind: "owner", reason: "Searches are waiting for your approval" };
    return run("research");
  }

  if (notes.status === "error") return { kind: "stopped", reason: "The research notes failed" };
  if (notes.status === "idle" && finished(research.status)) return run("notes");
  return { kind: "finished" };
}

function anyRunning(view: SessionView | null) {
  return Boolean(
    view?.members.some((m) => Object.values(m.state.steps).some((s) => s.status === "running")),
  );
}

/**
 * Loads a session and runs its steps one request at a time. Progress is saved
 * on disk after every step, so a refresh shows where things stand and "Run"
 * carries on from there.
 */
export function useSession(id: string) {
  const [view, setView] = useState<SessionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [driving, setDriving] = useState(false);
  const [pending, setPending] = useState(0);
  const inflight = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    const data = await boardApi<{ session: SessionView }>(`/api/board/sessions/${id}`);
    setView(data.session);
    return data.session;
  }, [id]);

  const runStep = useCallback(
    async ({ step, member, body }: StepRequest) => {
      const key = `${member}:${step}`;
      if (inflight.current.has(key)) return;
      inflight.current.add(key);
      setPending((n) => n + 1);
      setError(null);
      // Show "working" as soon as the server has marked the step as started.
      window.setTimeout(() => void refresh().catch(() => undefined), 300);
      try {
        const data = await boardApi<{ session: SessionView }>(
          `/api/board/sessions/${id}/steps/${step}`,
          { method: "POST", body: { member, ...body } },
        );
        setView(data.session);
      } catch (err) {
        setError(errorText(err));
        await refresh().catch(() => undefined);
      } finally {
        inflight.current.delete(key);
        setPending((n) => n - 1);
      }
    },
    [id, refresh],
  );

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      try {
        await refresh();
        if (cancelled) return;
        const url = new URL(window.location.href);
        if (url.searchParams.get("run") === "1") {
          url.searchParams.delete("run");
          window.history.replaceState(null, "", url.toString());
          setDriving(true);
        }
      } catch (err) {
        if (!cancelled) setError(errorText(err));
      }
    };
    void boot();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  // While "Run" is on, start whatever each member is ready for.
  useEffect(() => {
    if (!driving || !view) return;
    const requests = view.members.flatMap((member) => {
      const move = nextMove(member);
      return move.kind === "run" ? [move.request] : [];
    });
    if (!requests.length) return;
    queueMicrotask(() => {
      for (const request of requests) void runStep(request);
    });
  }, [driving, view, runStep]);

  // Keep the screen fresh while anything is in flight, here or in another tab.
  const watching = pending > 0 || anyRunning(view);
  useEffect(() => {
    if (!watching) return;
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [watching, refresh]);

  return {
    view,
    error,
    setError,
    refresh,
    runStep,
    driving,
    setDriving,
    working: watching,
  };
}
