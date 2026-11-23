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
