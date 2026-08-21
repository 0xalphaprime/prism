import { getEvalSet } from "./sets";
import { questionMatrix, summarizeArchitectures } from "./stats";
import type { ExperimentRecord } from "./types";

function failed(score: number | null | undefined) {
  return score != null && score < 0.5;
}

function passed(score: number | null | undefined) {
  return score != null && score >= 0.5;
}

/** Copy — not automation. Maps the score matrix onto the lab decision table. */
export function buildDecisionNotes(record: ExperimentRecord): string[] {
  const set = getEvalSet(record.evalSetId);
  const matrix = questionMatrix(record);
  const summaries = summarizeArchitectures(record);
  const notes: string[] = [];

  let feedbackFixes = 0;
  let allFailMissingContext = 0;
  let voiceWhileFacts = 0;
  let heldOutLag = 0;
  let easyDrop = 0;

  for (const row of matrix) {
    const item = set?.items.find((i) => i.id === row.itemId);
    const baseline = row.byArch["eval-baseline"];
    const refine = row.byArch["eval-teacher-refine"];
    const critic = row.byArch["eval-teacher-critic"];
    const bestFeedback = [refine?.revised, critic?.revised].find((s) => passed(s));

    if (baseline && failed(baseline.first) && bestFeedback) feedbackFixes += 1;

    const allFail =
      failed(baseline?.first) &&
      (refine ? failed(refine.revised ?? refine.first) : true) &&
      (critic ? failed(critic.revised ?? critic.first) : true);
    const goldMissing = (item?.goldFacts ?? []).some(
      (fact) => !item?.allowedContext.toLowerCase().includes(fact.toLowerCase()),
    );
    if (allFail && (goldMissing || (item && !item.goldFacts.length && !item.bits.length))) {
      allFailMissingContext += 1;
    }

    const voiceTag = (item?.tags ?? []).includes("prime-voice");
    if (voiceTag && passed(baseline?.first) && (refine?.lift ?? 0) <= 0) {
      voiceWhileFacts += 1;
    }

    if (item?.split === "held-out") {
      if (passed(critic?.revised) === false && passed(refine?.revised) === false) {
        heldOutLag += 1;
      }
    }
    if ((item?.tags ?? []).includes("easy") && failed(critic?.revised ?? critic?.first)) {
      easyDrop += 1;
    }
  }

  if (feedbackFixes) {
    notes.push(
      `Baseline fails and feedback fixes it on ${feedbackFixes} item(s) → improve SYSTEM / Steer first.`,
    );
  }
  if (allFailMissingContext) {
    notes.push(
      `All architectures fail on ${allFailMissingContext} item(s) with gold absent or item still a scaffold → RAG / tools, not a LoRA.`,
    );
  }
  if (voiceWhileFacts) {
    notes.push(
      `Right-enough facts with lingering voice issues on ${voiceWhileFacts} item(s) → possible LoRA candidate.`,
    );
  }
  if (heldOutLag) {
    notes.push(
      `Held-out items still fail after the card → stronger fine-tune candidate only if SYSTEM cannot retain it.`,
    );
  }
  if (easyDrop) {
    notes.push(
      `Easy / held-out prompts drop → reject the adapter if a fine-tune ever shows this pattern.`,
    );
  }

  const baseline = summaries.find((s) => s.architectureId === "eval-baseline");
  const critic = summaries.find((s) => s.architectureId === "eval-teacher-critic");
  if (baseline?.meanFirst != null && critic?.meanRevised != null) {
    const delta = critic.meanRevised - baseline.meanFirst;
    if (delta > 0.05) {
      notes.push(
        `Teacher + critic mean revised is ${delta.toFixed(2)} above baseline first-pass — full feedback lift is real on this set.`,
      );
    }
  }

  if (!notes.length) {
    notes.push("Not enough scored cells for a decision yet. Fill leftover gold/bits, then re-run.");
  }
  return notes;
}
