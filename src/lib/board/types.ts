/**
 * Board: persistent members who read the same material and differ by
 * personality and research directives.
 */

/** Stored as `member.json` in the member's folder. */
export type MemberMeta = {
  slug: string;
  name: string;
  /** One line: what this member is accountable for. */
  title: string;
  /** Optional model override. Empty means "use the session's model". */
  model?: string;
  createdAt: number;
  updatedAt: number;
};

/** A living file under `files/`. Plain markdown that changes over time. */
export type MemberFile = {
  name: string;
  content: string;
  updatedAt: number;
};

export type Member = MemberMeta & {
  /** `profile.md`: experience, beliefs, how they weigh evidence, what they miss. */
  profile: string;
  /** `directives.md`: where they look, what they chase, which sources they trust. */
  directives: string;
  files: MemberFile[];
};

export type MemberSummary = MemberMeta & {
  profileChars: number;
  directivesChars: number;
  fileCount: number;
};

export type MemberDraft = {
  name: string;
  title: string;
  profile: string;
  directives: string;
  model?: string;
  files?: Array<{ name: string; content: string }>;
};

/* ---------- Sessions ---------- */

/** How much one member may pull from outside in one research round. */
export type ResearchLimits = {
  searches: number;
  pagesPerSearch: number;
  pageChars: number;
};

export type StepStatus = "idle" | "running" | "done" | "error" | "skipped";

export type StepState = {
  status: StepStatus;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  /** Model that answered, as reported by the provider. */
  model?: string;
  /** Plain labels for everything that was put in front of the model. */
  saw?: string[];
};

export type PlannedQuery = {
  query: string;
  why: string;
};

/** `plan.json`: the searches a member wants to run. */
export type MemberPlan = {
  queries: PlannedQuery[];
  /** True once the searches may run. */
  approved: boolean;
  /** True when the owner changed the list before approving. */
  editedByOwner?: boolean;
  /** Queries that repeat a name or figure from the material, with the terms found. */
  flagged: Array<{ query: string; terms: string[] }>;
  createdAt: number;
};

export type SearchHit = {
  url: string;
  title: string;
  description: string;
};

export type QueryRecord = {
  query: string;
  why: string;
  startedAt: number;
  finishedAt: number;
  error?: string;
  hits: Array<SearchHit & { read: boolean; skipped?: string }>;
};

export type PageRecord = {
  /** Source id the member cites, e.g. `S1`. */
  id: string;
  url: string;
  title: string;
  query: string;
  via: string;
  fetchedAt: number;
  /** Characters kept after the per-page limit. */
  chars: number;
  truncated: boolean;
  text: string;
  error?: string;
};

/** `research.json`: everything one member searched for and read. */
export type ResearchRecord = {
  limits: ResearchLimits;
  startedAt: number;
  finishedAt: number;
  queries: QueryRecord[];
  pages: PageRecord[];
};

export type MemberStepName = "plan" | "research" | "notes";

export type SeatState = {
  steps: Record<MemberStepName, StepState>;
};

/** `trial` runs research only, for tuning a member's directives. */
export type SessionKind = "trial";

export type SessionSeat = {
  slug: string;
  name: string;
  title: string;
  model?: string;
};

/** Stored as `session.json`. */
export type SessionMeta = {
  id: string;
  kind: SessionKind;
  title: string;
  question: string;
  /** The material every member reads. */
  material: string;
  /** Marks the decision as sensitive: searches always wait for approval. */
  sensitive: boolean;
  approveSearches: boolean;
  /** Model ref (`provider:model`) used unless a member overrides it. */
  model: string;
  limits: ResearchLimits;
  members: SessionSeat[];
  createdAt: number;
  updatedAt: number;
};

export type SessionDraft = {
  kind?: SessionKind;
  title?: string;
  question: string;
  material?: string;
  sensitive?: boolean;
  approveSearches?: boolean;
  model: string;
  limits?: Partial<ResearchLimits>;
  members: string[];
};

/** A member as they were when the session started. */
export type MemberSnapshot = {
  slug: string;
  name: string;
  title: string;
  model?: string;
  profile: string;
  directives: string;
  files: Array<{ name: string; content: string }>;
};

export type SessionMemberView = SessionSeat & {
  state: SeatState;
  plan: MemberPlan | null;
  research: ResearchRecord | null;
  notes: string | null;
};

export type OverlapReport = {
  /** Sources at least two members pulled. */
  shared: Array<{ url: string; title: string; members: string[] }>;
  /** Distinct sources across all members. */
  distinct: number;
  /** Share of distinct sources that two or more members pulled, 0 to 1. */
  figure: number;
  pairs: Array<{ a: string; b: string; shared: number }>;
};

export type SessionView = Omit<SessionMeta, "members"> & {
  members: SessionMemberView[];
  overlap: OverlapReport;
  dir: string;
};

export type SessionSummary = {
  id: string;
  kind: SessionKind;
  title: string;
  question: string;
  createdAt: number;
  members: string[];
  sensitive: boolean;
};
