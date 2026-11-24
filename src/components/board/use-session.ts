"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { boardApi, errorText } from "@/components/board/board-api";
import type { SessionMemberView, SessionView, StepState, StepStatus } from "@/lib/board/types";

export type StepRequest = { step: string; member?: string; body?: Record<string, unknown> };

export type NextMove =
  | { kind: "run"; request: StepRequest }
  | { kind: "busy" }
  /** Waiting for the owner (an approval). */
  | { kind: "owner"; reason: string }
  /** Waiting for other seats to finish. */
  | { kind: "waiting"; reason: string }
  | { kind: "stopped"; reason: string }
  | { kind: "finished" };

function finished(status: StepStatus) {
  return status === "done" || status === "skipped";
}

function anyRunningIn(steps: Record<string, StepState>) {
  return Object.values(steps).some((s) => s.status === "running");
}

/** A step the session does not run is saved as skipped. */
function on(state: StepState) {
  return state.status !== "skipped";
}

/** True once a member's opinion is final: given, and revised if the session has a second round. */
export function opinionSettled(member: SessionMemberView) {
  const { opinion, revised } = member.state.steps;
  return opinion.status === "done" && (!on(revised) || revised.status === "done");
}

/** The steps after the blind round, for a member whose first opinion is in. */
function laterMove(member: SessionMemberView, view: SessionView, run: (step: string) => NextMove): NextMove {
  const { plan2, research2, revised, premortem, cross } = member.state.steps;

  if (on(plan2)) {
    const map = view.chair?.state.map;
    if (plan2.status === "error") return { kind: "stopped", reason: "The second search plan failed" };
    if (plan2.status === "idle") {
      if (map?.status !== "done") return { kind: "waiting", reason: "Waiting for the Chair's list of open points" };
      return run("plan2");
    }
    if (research2.status === "error") return { kind: "stopped", reason: "The second round of research failed" };
    if (research2.status === "idle") {
      if (!member.plan2?.approved) return { kind: "owner", reason: "Second-round searches are waiting for your approval" };
      return run("research2");
    }
    if (revised.status === "error") return { kind: "stopped", reason: "The revised opinion failed" };
    if (revised.status === "idle") return run("revised");
  }

  if (on(premortem)) {
    if (premortem.status === "error") return { kind: "stopped", reason: "The premortem failed" };
    if (premortem.status === "idle") return run("premortem");
  }

  if (on(cross)) {
    if (cross.status === "error") return { kind: "stopped", reason: "The cross-examination failed" };
    if (cross.status === "idle") {
      const others = view.members.filter((m) => !m.state.dropped);
      if (!others.every(opinionSettled)) {
        return { kind: "waiting", reason: "Cross-examination starts once every opinion is final" };
      }
      return run("cross");
    }
  }
  return { kind: "finished" };
}

/** What should happen next for one member, read off the saved state. */
export function memberMove(member: SessionMemberView, view: SessionView): NextMove {
  const { plan, research, notes, opinion } = member.state.steps;
  if (member.state.dropped) return { kind: "finished" };
  if (anyRunningIn(member.state.steps)) return { kind: "busy" };
  const run = (step: string): NextMove => ({ kind: "run", request: { step, member: member.slug } });

  if (plan.status === "error") return { kind: "stopped", reason: "The search plan failed" };
  if (plan.status === "idle") return run("plan");

  if (research.status === "error") return { kind: "stopped", reason: "Research failed" };
  if (research.status === "idle") {
    if (!member.plan?.approved) return { kind: "owner", reason: "Searches are waiting for your approval" };
    return run("research");
  }

  if (notes.status === "error") return { kind: "stopped", reason: "The research notes failed" };
  if (notes.status === "idle") return run("notes");

  if (view.kind === "board") {
    if (opinion.status === "error") return { kind: "stopped", reason: "The opinion failed" };
    if (opinion.status === "idle") return run("opinion");
    return laterMove(member, view, run);
  }
  return { kind: "finished" };
}

export function opinionCount(view: SessionView) {
  const active = view.members.filter((m) => !m.state.dropped);
  return {
    total: active.length,
    done: active.filter((m) => m.state.steps.opinion.status === "done").length,
  };
}

export function chairMove(view: SessionView): NextMove {
  if (!view.chair) return { kind: "finished" };
  const { map, memo } = view.chair.state;
  if (memo.status === "running" || map.status === "running") return { kind: "busy" };
  if (memo.status === "done") return { kind: "finished" };
  if (memo.status === "error") return { kind: "stopped", reason: "The Chair's memo failed" };
  const { done, total } = opinionCount(view);
  if (total === 0 || done < total) return { kind: "waiting", reason: `${done} of ${total} opinions in` };
  if (on(map)) {
    if (map.status === "error") return { kind: "stopped", reason: "The Chair's list of open points failed" };
    if (map.status === "idle") return { kind: "run", request: { step: "map" } };
  }
  // The memo waits for every member to finish whatever later rounds this session runs.
  const active = view.members.filter((m) => !m.state.dropped);
  const left = active.filter((m) => memberMove(m, view).kind !== "finished").length;
  if (left) return { kind: "waiting", reason: `${left} of ${active.length} members still in the later rounds` };
  return { kind: "run", request: { step: "chair" } };
}

export function generalistMove(view: SessionView): NextMove {
  const g = view.generalist;
  if (!g) return { kind: "finished" };
  const { plan, research, memo } = g.state.steps;
  if (anyRunningIn(g.state.steps)) return { kind: "busy" };
  const run = (step: string): NextMove => ({ kind: "run", request: { step } });

  if (plan.status === "error") return { kind: "stopped", reason: "The generalist's search plan failed" };
  if (plan.status === "idle") return run("generalist-plan");
  if (research.status === "error") return { kind: "stopped", reason: "The generalist's research failed" };
  if (research.status === "idle") {
    if (!g.plan?.approved) {
      return { kind: "owner", reason: "The generalist's searches are waiting for your approval" };
    }
    return run("generalist-research");
  }
  if (memo.status === "error") return { kind: "stopped", reason: "The generalist's memo failed" };
  if (memo.status === "idle" && finished(research.status)) return run("generalist-memo");
  return { kind: "finished" };
}

export function allMoves(view: SessionView): NextMove[] {
  return [...view.members.map((m) => memberMove(m, view)), chairMove(view), generalistMove(view)];
}

function anyRunning(view: SessionView | null) {
  if (!view) return false;
  return (
    view.members.some((m) => anyRunningIn(m.state.steps)) ||
    view.chair?.state.memo.status === "running" ||
    view.chair?.state.map.status === "running" ||
    view.members.some((m) => m.lessons?.state.status === "running") ||
    Boolean(view.generalist && anyRunningIn(view.generalist.state.steps))
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

  // Answers can arrive out of order; never replace what is shown with an older reading.
  const apply = useCallback((next: SessionView) => {
    setView((current) => (current && current.id === next.id && current.readAt > next.readAt ? current : next));
  }, []);

  const refresh = useCallback(async () => {
    const data = await boardApi<{ session: SessionView }>(`/api/board/sessions/${id}`);
    apply(data.session);
    return data.session;
  }, [id, apply]);

  const runStep = useCallback(
    async ({ step, member, body }: StepRequest) => {
      const key = `${member ?? ""}:${step}`;
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
        apply(data.session);
      } catch (err) {
        setError(errorText(err));
        await refresh().catch(() => undefined);
      } finally {
        inflight.current.delete(key);
        setPending((n) => n - 1);
      }
    },
    [id, refresh, apply],
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

  // While "Run" is on, start whatever each seat is ready for.
  useEffect(() => {
    if (!driving || !view) return;
    const requests = allMoves(view).flatMap((move) => (move.kind === "run" ? [move.request] : []));
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
    apply,
    runStep,
    driving,
    setDriving,
    working: watching,
  };
}
