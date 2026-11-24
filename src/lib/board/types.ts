/**
 * Board: persistent members who read the same material and differ by
 * personality and research directives.
 */

/** The owner's own records a member may be allowed to search. */
export type OwnSource = "knowledge" | "airtable" | "github";

export const OWN_SOURCES: OwnSource[] = ["knowledge", "airtable", "github"];

/** Stored as `member.json` in the member's folder. */
export type MemberMeta = {
  slug: string;
  name: string;
  /** One line: what this member is accountable for. */
  title: string;
  /** Optional model override. Empty means "use the session's model". */
  model?: string;
  /** Own records this member may search as well as the web. Empty means web only. */
  sources?: OwnSource[];
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
  sources?: OwnSource[];
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
  /** `own` searches the owner's own records and never goes to the public web. */
  where?: "own";
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
  where?: "own";
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

/**
 * The first four are the blind round. The rest only run when the session asks
 * for them, and only after every member's first opinion is in:
 * `plan2`, `research2` and `revised` are the Deep speed's second research round;
 * `cross` is cross-examination; `premortem` is the premortem.
 */
export type MemberStepName =
  | "plan"
  | "research"
  | "notes"
  | "opinion"
  | "plan2"
  | "research2"
  | "revised"
  | "cross"
  | "premortem";

export type SeatState = {
  steps: Record<MemberStepName, StepState>;
  /** The owner chose to go on without this member. */
  dropped?: boolean;
};

export type GeneralistStepName = "plan" | "research" | "memo";

export type GeneralistState = {
  steps: Record<GeneralistStepName, StepState>;
};

export type ChairState = {
  /** Deep speed only: the points the members disagree on, written before the second round. */
  map: StepState;
  memo: StepState;
};

/** One thing the members disagree on, worded without saying who holds which side. */
export type OpenPoint = {
  id: string;
  point: string;
  /** What evidence would settle it. */
  settle: string;
};

/** `map.json`: what the second research round is aimed at. */
export type DisagreementMap = {
  points: OpenPoint[];
  createdAt: number;
};

/**
 * `trial` runs research only, for tuning a member's directives.
 * `board` is a full session: research, blind opinions, Chair memo.
 */
export type SessionKind = "trial" | "board";

/**
 * `fast`: no outside research, one or two members. `standard`: the full flow.
 * `deep`: standard, then a second research round aimed at what the members disagree on.
 */
export type SessionSpeed = "fast" | "standard" | "deep";

/** Optional rounds after the first opinions are in. */
export type SessionRounds = {
  /** Each member reads the others' opinions and answers them. */
  crossExam?: boolean;
  /** Each member assumes their own advice was followed and failed, and says why. */
  premortem?: boolean;
};

export type SessionSeat = {
  slug: string;
  name: string;
  title: string;
  model?: string;
  /** Length of the private dossier given to this member only, if any. */
  dossierChars?: number;
};

/** Stored as `session.json`. */
export type SessionMeta = {
  id: string;
  kind: SessionKind;
  title: string;
  question: string;
  /** The material every member reads. */
  material: string;
  /** Standing context about the owner, copied in when the session started. */
  standing?: string;
  speed?: SessionSpeed;
  rounds?: SessionRounds;
  /** Also run one generalist on the same material with the same search allowance. */
  withGeneralist?: boolean;
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
  speed?: SessionSpeed;
  rounds?: SessionRounds;
  /** Private material for single members, keyed by member id. Off unless given. */
  dossiers?: Record<string, string>;
  withGeneralist?: boolean;
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
  sources?: OwnSource[];
  files: Array<{ name: string; content: string }>;
};

/** One proposed addition to a member's `lessons.md`. Nothing is saved until the owner approves it. */
export type LessonProposal = {
  id: string;
  text: string;
  status: "proposed" | "approved" | "rejected";
  decidedAt?: number;
};

/** `lessons.json` in a member's session folder. */
export type LessonsRecord = {
  state: StepState;
  proposals: LessonProposal[];
};

export type SessionMemberView = SessionSeat & {
  state: SeatState;
  plan: MemberPlan | null;
  research: ResearchRecord | null;
  /** Null while sealed, even if written. */
  notes: string | null;
  /** Null while sealed, even if written. */
  opinion: string | null;
  /** The owner's private note to this member. The owner wrote it, so it is never sealed. */
  dossier: string | null;
  plan2: MemberPlan | null;
  research2: ResearchRecord | null;
  /** The opinion after the second research round. Null if the first one stands. */
  revised: string | null;
  cross: string | null;
  premortem: string | null;
  lessons: LessonsRecord | null;
};

export type GeneralistView = {
  state: GeneralistState;
  plan: MemberPlan | null;
  research: ResearchRecord | null;
  memo: string | null;
  limits: ResearchLimits;
};

export type ChairView = {
  state: ChairState;
  map: DisagreementMap | null;
  memo: string | null;
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
  /**
   * True in a board session until every member still taking part has given an
   * opinion. While sealed, notes and opinions are left out of what the screen
   * is sent.
   */
  sealed: boolean;
  chair: ChairView | null;
  generalist: GeneralistView | null;
  overlap: OverlapReport;
  dir: string;
  /** When this view was read from disk. The screen ignores a view older than the one it shows. */
  readAt: number;
};

export type SessionSummary = {
  id: string;
  kind: SessionKind;
  title: string;
  question: string;
  createdAt: number;
  members: string[];
  sensitive: boolean;
  speed?: SessionSpeed;
  /** `finished` once the Chair memo is written (board) or all research is in (trial). */
  finished: boolean;
};

/* ---------- Decisions ---------- */

export type DecisionStatus = "undecided" | "decided" | "parked" | "dropped";

/** Stored as `decision.json` in the session's folder. What the owner did with the advice. */
export type DecisionRecord = {
  status: DecisionStatus;
  /** What was decided, in the owner's words. */
  choice: string;
  rationale: string;
  /** `YYYY-MM-DD`: when to come back and check how it went. */
  reviewOn?: string;
  /** What actually happened, filled in at review. */
  outcome: string;
  decidedAt?: number;
  updatedAt: number;
};

export type DecisionDraft = {
  status?: DecisionStatus;
  choice?: string;
  rationale?: string;
  reviewOn?: string;
  outcome?: string;
};

export type DecisionRow = {
  id: string;
  title: string;
  question: string;
  createdAt: number;
  speed?: SessionSpeed;
  members: string[];
  /** True once the Chair's memo is written. */
  sessionFinished: boolean;
  /** The Chair's recommendation, if the memo has one. */
  recommendation: string | null;
  decision: DecisionRecord;
  /** Why this still needs the owner, or null when nothing is outstanding. */
  looseEnd: string | null;
  /** The hand-off file, if one has been written. */
  handoff: string | null;
};
