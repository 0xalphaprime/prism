import { interviewPrompt, parseInterview, type InterviewReply, type InterviewTurn } from "./compose";
import type { BoardChatFn } from "./session-runner";
import { BoardStoreError, boardRoot, listMembers } from "./store";

const MAX_TURNS = 24;
const MAX_TURN_CHARS = 4_000;

function cleanTranscript(raw: unknown): InterviewTurn[] {
  if (!Array.isArray(raw)) return [];
  if (raw.length > MAX_TURNS) throw new BoardStoreError("The interview is too long. Ask for the draft now.");
  const turns: InterviewTurn[] = [];
  for (const item of raw) {
    const role = (item as { role?: unknown } | null)?.role;
    const text = (item as { text?: unknown } | null)?.text;
    if ((role !== "interviewer" && role !== "owner") || typeof text !== "string" || !text.trim()) {
      throw new BoardStoreError("The interview so far could not be read");
    }
    turns.push({ role, text: text.trim().slice(0, MAX_TURN_CHARS) });
  }
  return turns;
}

/**
 * One turn of the interview that drafts a new member. Nothing is kept on the
 * server between turns and nothing is saved: the draft goes back to the
 * screen, where the owner edits it and creates the member themselves.
 */
export async function interviewTurn(
  args: { model: string; transcript: unknown; finish?: boolean },
  deps: { chat: BoardChatFn; root?: string },
): Promise<InterviewReply> {
  const model = typeof args.model === "string" ? args.model.trim() : "";
  if (!model) throw new BoardStoreError("Choose a model");
  const transcript = cleanTranscript(args.transcript);
  if (args.finish && !transcript.some((t) => t.role === "owner")) {
    throw new BoardStoreError("Answer at least one question before asking for the draft");
  }
  const existing = (await listMembers(deps.root ?? boardRoot())).map((m) => ({ name: m.name, title: m.title }));
  const prompt = interviewPrompt({ transcript, existing, finish: Boolean(args.finish) });
  const reply = await deps.chat({
    model,
    system: prompt.system,
    user: prompt.user,
    maxTokens: prompt.maxTokens,
  });
  return parseInterview(reply.content ?? "");
}
