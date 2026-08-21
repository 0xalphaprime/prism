# Variety toolkit — brainstorm (Ashby)

**Principle.** *Only variety can absorb variety.*  
Prism exists so authors can **compose enough structured variety** — paths, roles, models, context injects, run policies — to match hard problems, without collapsing into one opaque chat.

This note is a living roadmap for what the lab should offer. It is not a commitment that every row ships next.

---

## 1. What “variety” means here

| Layer | Variety lever | Absorbs |
|-------|---------------|---------|
| Topology | Who connects to whom; hubs; late injects; parallel judges | Problem structure / branching |
| Roles & Steer | Distinct jobs + proximal constraints; **node presets** | Homogenization / mushy outputs |
| Models | Heterogeneous `provider:model` | Capability gaps |
| Context | Channels, slots, inject timing | Missing facts / domain grounding |
| Runs | Step, checkpoints, sweeps, compare | Uncertainty / experiment noise |
| Publish | Forkable architectures + sample runs | Transfer of method across people |

Anti-pattern: *more of the same* (same model × n, all-to-all noise) pretending to be variety.

---

## 2. Topology variety (graph)

**Have now (CRUD pass)**

- Add Agent / Split / Judge / Context Hub / context channels
- Delete tiles (protect last Hub)
- Free rewire + edge reconnect; channel → Hub by default
- Optional **late inject**: channel or Hub → downstream agent/router/merge

**Build next**

- Visual distinction for “inject” edges vs main spine
- Skip-router edges (Hub → agent) as first-class pattern
- Optional critique loops (agent ⇄ critic) with cycle caps
- Parallel Judges / multi-hub graphs with layout that doesn’t fight the author
- Fan-in policies preview (who feeds Judge)

**Later**

- Keep-k / moderator gates on edges (SMoA)
- Budgeted activation on Split (RouteMoA-style)
- Saved topology snippets (“debate fork”, “research triad”)

---

## 3. Node attributes (the expand workspace)

**Have now (schema + Expand Controls; Step / Run all enforce at run)**

| Attribute | Where | Notes |
|-----------|--------|------|
| Label | Expand | Human name |
| Role | Expand (downstream) | Job in the MoA |
| Steer | Expand (downstream) | Proximal how-to |
| Prompt | Expand (agent/merge) | Task |
| Model | Expand (agent/merge) | `provider:model` |
| Hub notes | Expand (context) | Freeform upstream |
| **Budget** | Expand Controls (agent/merge) | max tokens / latency / $ |
| **Sampling** | Expand Controls (agent/merge) | temperature / seed |
| **Tools allowlist** | Expand Controls (agent/merge) | ≤5 names |
| **Output schema** | Expand Controls (agent/merge) | shape sketch |
| **Keep-k / stop** | Expand Controls (router/merge) | `forward.keepK`, consensus, maxRounds |
| **Eval rubric** | Expand Controls (agent/merge) | compare / Judge checklist |
| **Publish visibility** | Expand Controls (downstream) | includeInSamples / redactOutput |
| Output / metrics | Expand + output page | Filled in Block 3 |

**Node presets (local).** Save Split / agent / Judge role packs from Expand; place from Add tile. Built-ins: Researcher, Writer, Critic, Summarizer, Red-team, Split (route), Judge (crisp). User presets are deletable. Middle unit between blank tiles and full architecture templates.

**Cut:** separate **input map** UI. Graph edges *are* the input map; default packing = everything upstream. Per-edge filters (titles-only etc.) stay later under Context variety.

Steer stays the *proximal* dial above Controls — don’t bury it.

---

## 4. Context variety

**Default story:** channels → **Context Hub** → Split → specialists.

**Intentional exceptions:** late inject into a single agent (e.g. Skills only into Critic).

**Build toward**

- Context **recipes** (slots) already in publish schema — surface in UI  
- Per-edge filters (“this edge carries titles only / full text”)  
- Weights or priority when multiple injects hit one node  
- Redaction presets for publish samples  

---

## 5. Run variety

**Now:** Step / Run all execute the pathway (intelligent Split + agents + Judge). Log checkpoint still snapshots without running.

**Toolkit to offer**

| Mode | Purpose |
|------|---------|
| Step | One node at a time; inspect artifact |
| Run all | Full pathway |
| **Eval Lab** | Frozen questions × isolated architectures × reps; binary scores + experiment package |
| Seeded rerun | Same topology, fixed seed |
| Model sweep | Same Role/Steer/Prompt, swap models |
| Compare runs | Diff outputs / metrics side by side |
| Parallel instances | Extreme: many pathway copies (later) |

Every mode should leave **inspectable artifacts** — that *is* the product.

---

## 6. Authoring & public-good variety

- Templates (starter MoA, debate, blank, **student vs teachers**)  
- Talk bar mutations  
- Publish packages (architecture + recipe + sample runs)  
- Fork lineage (`forkedFrom`)  
- Gallery later — architectures as the unit of expression  

Marketplace tip-outs are product layer later; the open toolkit comes first.

---

## 7. Mapping to research (short)

| Research idea | Prism lever |
|---------------|-------------|
| MoA proposers + synthesizer | Agents + Judge; Role/Steer diversity |
| SMoA keep-k / moderator | Node `forward` (keepK / stop / maxRounds); edge gates later |
| RouteMoA sparse activation | Split + budget fields (enforcement later) |
| Fan-out / fan-in | Free topology + late inject |
| Durable observability | Runs + per-node metrics + output pages |

Full notes: [`RESEARCH.md`](../RESEARCH.md).

---

## 8. Sequencing (opinionated)

1. **Done** — graph CRUD, Expand attributes, Hub + late inject  
2. **Done (Block 3)** — Step / Run all; intelligent Split route plan; compose Role+Steer+Prompt+context; temp / max tokens / keep-k / schema hint  
3. **Next** — Compare runs + leftover gold fill + publish export UI (rubric + visibility)  
4. **Edge filters / richer Route levers** — sparsify *what* travels; learned activation beyond one plan call  
5. **Gallery + parallel instances** — public-good scale  

---

## 9. Design tests (use when adding features)

1. Does this add *structured* variety, or just more chrome?  
2. Can an author see and edit it on the graph or in Expand?  
3. Does it leave an inspectable artifact?  
4. Can it be versioned with the architecture / publish package?  
5. Would Ashby recognize this as matching variety to the problem — or as noise?

---

*Living doc. Patch when experiments contradict a priority.*
