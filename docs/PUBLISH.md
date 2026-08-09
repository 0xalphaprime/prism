# Prism Publish Package (schema sketch)

**Status.** Draft schema for the public-good loop: *compose → prove → publish → fork*.  
**Code.** Types + builders in [`src/lib/publish.ts`](../src/lib/publish.ts).  
**Grounded in.** [`PrismDocument`](../src/lib/document.ts) + [`RunRecord`](../src/lib/runs.ts).

---

## Goal

Experts express themselves by shipping a portable package:

1. **Architecture** — topology + Label / Role / Steer / Prompt / models  
2. **Context recipe** — what slots a re-runner must fill (not private dumps by default)  
3. **Sample runs** — 1–3 proof artifacts with per-node outputs and metrics  
4. **Listing** — attribution, license, methodology badges  

Hosted inference (when it exists) can use a plain account **balance**; that stays outside this package format.

---

## File shape

```json
{
  "kind": "prism.publish",
  "schemaVersion": 1,
  "packageId": "uuid",
  "listing": { "...": "gallery + attribution" },
  "architecture": { "...": "graph + recipe + variables" },
  "sampleRuns": [{ "...": "up to 3 proof runs" }]
}
```

Suggested download name: `{slug}-v{version}.prism.publish.json`

---

## Objects

### `listing`

| Field | Purpose |
|-------|---------|
| `slug` | URL-safe id |
| `title` / `summary` | Gallery card |
| `tags` | Freeform |
| `methodology` | Badges: `moa`, `smoa`, `routemoa`, `fan-out-fan-in`, `debate`, `refine`, `custom` |
| `license` | `mit`, `apache-2.0`, `cc-by-4.0`, `cc0`, `proprietary`, `unset` |
| `visibility` | `public`, `unlisted`, `private` |
| `author` | `{ id, name }` |
| `forkedFrom` | Parent `{ packageId, architectureId, version, slug? }` |

### `architecture`

Stripped from a local `PrismDocument`:

| Included | Omitted |
|----------|---------|
| nodes (Label, Role, Steer, Prompt, model) | connection secrets / probe state |
| edges | live `output` / `metrics` / run `status` on nodes |
| architecture `prompt` (run intent) | full private attachments by default |
| `contextRecipe` (slots) | |
| `requiredProviders` (e.g. `openai`, `xai`) | API keys |
| optional `contextSamples` (redacted) | |

**Context recipe vs samples**

- **Recipe** — “needs Knowledge (1) + Documents (1)”. Always publish this.  
- **Samples** — optional truncated payloads for demos; mark `redacted: true` when stripped.

### `sampleRuns[]` (max 3)

Maps from `RunRecord`, enriched with Role/Steer from the graph at publish time:

- run intent `prompt`
- `nodeResults[]` — output, model, metrics, role, steer  
- `totals` — latency / tokens / estimated $  

---

## Mapping from today’s local document

| `PrismDocument` | Publish package |
|-----------------|-----------------|
| `id`, `name`, `description`, `prompt`, `tags`, `templateId` | `architecture.*` |
| `nodes`, `edges` | scrubbed into `architecture` |
| `enabledContextKinds` + `attachedContext` | `contextRecipe` (+ optional samples) |
| `owner` | `listing.author` |
| `runs` (selected ids) | `sampleRuns` |
| `connections` | **dropped** — re-runner uses their Connections |

Builder: `buildPublishPackage(doc, { slug, summary, sampleRunIds })`.

---

## Import / fork (target behavior)

1. Parse `prism.publish` JSON  
2. Create a new local `PrismDocument` with new ids  
3. Set `forkedFrom` on the next publish  
4. Leave `attachedContext` empty unless samples are opted in  
5. Prompt the user to fill **context slots** + verify **requiredProviders**

---

## Privacy defaults

- Recipe-only context (no payloads) unless author opts in  
- Truncate sample text (builder default cap 2k)  
- Never embed env keys or connection secrets  
- Sample runs should be ones the author chose to show

---

## Out of scope for this sketch

- Gallery UI / hosting  
- Billing / account balance  
- Automatic publish button in the app (types are ready to wire)

---

*When Block 3 fills `nodeResults`, publishing proof runs becomes real. Until then, packages still share architectures + recipes.*
