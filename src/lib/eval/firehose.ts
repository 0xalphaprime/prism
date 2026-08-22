/** Reject CRM / secrets / Starter MoA seed in leftover allowedContext. */

const STARTER_HUB_SEED = /brief a product team/i;

const FIREHOSE_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: "url", re: /https?:\/\//i },
  { id: "pat", re: /\bAIRTABLE_PAT\b|\bpat\b.*\.env|\.env.*\bpat\b/i },
  { id: "env-file", re: /\.env(?:\.local)?\b/i },
  { id: "slack-archive", re: /slack\.com\//i },
  { id: "starter-hub-seed", re: STARTER_HUB_SEED },
];

export function firehoseHits(allowedContext: string): string[] {
  const text = allowedContext ?? "";
  return FIREHOSE_PATTERNS.filter((row) => row.re.test(text)).map((row) => row.id);
}

export function assertNoFirehose(allowedContext: string) {
  const hits = firehoseHits(allowedContext);
  if (hits.length) {
    throw new Error(
      `allowedContext looks like a firehose (${hits.join(", ")}). Gold facts only — no CRM, PAT, Slack URLs, or Starter MoA hub seed.`,
    );
  }
}
