/**
 * Who the student writes as in steers ("Do the job as …"). Real company names
 * stay out of the public repo: set `PRISM_ORG_NAME` in `.env.local`
 * (inlined by next.config.ts). Unset → "our team".
 */
export const ORG_NAME = process.env.PRISM_ORG_NAME?.trim() || "our team";
