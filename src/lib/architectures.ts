/**
 * Compatibility shim — canonical types live in `document.ts`.
 * Prefer importing from `@/lib/document` in new code.
 */
export {
  clearRunFields,
  createStarterDocument,
  defaultLibrary,
  DOCUMENT_SCHEMA_VERSION,
  exportDocument,
  importDocument,
  LIBRARY_KEY as ARCHIVES_KEY,
  loadLibrary,
  saveLibrary,
  type Architecture,
  type PrismDocument,
  type PrismLibrary as ArchitectureLibrary,
} from "./document";

import { createDocumentFromGraph, type PrismDocument } from "./document";
import type { PrismUser } from "./identity";

/** Legacy helper used by older store call sites */
export function createStarterArchitecture(
  name = "Starter MoA",
  prompt = "",
  owner: Pick<PrismUser, "id" | "name"> = {
    id: "local",
    name: "Local builder",
  },
): PrismDocument {
  return createDocumentFromGraph({
    name,
    owner,
    prompt,
    description: "Classic mixture-of-agents critique loop",
    tags: ["moa", "default"],
    templateId: "starter-moa",
  });
}
