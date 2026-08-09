# RESEARCH.md — MoA lineage & agentic orchestration stack

**Purpose.** Concise field notes from a 7-source reading pass: the MoA quality → sparsity → routing → serving lineage (papers 1–4), then production orchestration/durability/tooling (sources 5–7).  
**Audience.** Future Hermes / on-prem MoA-lab work — pick patterns, not cargo-cult full papers.  
**Last updated.** 2026-08-08  

---

## At a glance (the story arc)

```
QUALITY                          COST / LATENCY                         PRODUCTION
─────────────────────────────────────────────────────────────────────────────────
1. MoA          dense multi-LLM layers; open models beat GPT-4o (pref)
2. SMoA         top-k replies + early-stop + roles  (sparse messages)
3. RouteMoA     pick who runs BEFORE inference     (sparse activation)
4. Faster-MoA   tree topology + EE + PD overlap    (sparse graph + hardware)
─────────────────────────────────────────────────────────────────────────────────
5. LangGraph durable execution   survive crashes / HITL / long runs
6. Ganji orchestration patterns  sequential / router / fan-out / reflect
7. Sapkota et al. toolchain tax. LangChain · LangGraph · LangSmith roles
```

**One-line thesis for the lab**

> Diverse proposers + a strong synthesizer beat a single model; then sparsify *messages*, then *activation*, then *topology+GPU schedule*; wire it as an explicit durable graph with observability — not a free-form multi-agent chat.

---

## Source index (7)

| # | Short name | Kind | Link |
|---|------------|------|------|
| 1 | **MoA** | Paper | [arXiv:2406.04692](https://arxiv.org/abs/2406.04692) · [pdf](https://arxiv.org/pdf/2406.04692) · [HTML](https://ar5iv.labs.arxiv.org/html/2406.04692) · [Together code](https://github.com/togethercomputer/moa) |
| 2 | **SMoA** | Paper | [arXiv:2411.03284](https://arxiv.org/abs/2411.03284) · [pdf](https://arxiv.org/pdf/2411.03284) |
| 3 | **RouteMoA** | Paper (ACL 2026) | [ACL Anthology](https://aclanthology.org/2026.acl-long.558/) · [pdf](https://aclanthology.org/2026.acl-long.558.pdf) · [code](https://github.com/Jory-W/RouteMoA) |
| 4 | **Faster-MoA** | Paper | [arXiv:2512.18126](https://arxiv.org/abs/2512.18126) · [pdf](https://arxiv.org/pdf/2512.18126) · [HTML](https://arxiv.org/html/2512.18126) |
| 5 | **LangGraph durable exec / persistence** | Docs | [Durable execution URL](https://docs.langchain.com/oss/python/langgraph/durable-execution) (resolves into persistence) · [Persistence](https://docs.langchain.com/oss/python/langgraph/persistence) · [Checkpointers](https://docs.langchain.com/oss/python/langgraph/checkpointers) · [Stores](https://docs.langchain.com/oss/python/langgraph/stores) · [Interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts) · [Overview](https://docs.langchain.com/oss/python/langgraph/overview) |
| 6 | **Ganji — Agentic orchestration** | Essay / practice | [abhilashganji.com — Multi-Agent Orchestration Patterns with LangGraph](https://abhilashganji.com/research/agentic-ai-orchestration.html) |
| 7 | **Sapkota et al. — Toolchain taxonomy** | TechRxiv preprint | [DOI](https://doi.org/10.36227/techrxiv.175695645.52670060/v1) · [TechRxiv page](https://www.techrxiv.org/doi/full/10.36227/techrxiv.175695645.52670060/v1) · [PDF](https://www.techrxiv.org/doi/pdf/10.36227/techrxiv.175695645.52670060/v1?download=true) · [Project page](https://rashik.info.np/agentic_ai_toolchains/) |

Related session notes (this conversation): MoA eq. (1), SMoA top‑k/ES/roles, RouteMoA dynamic route role.

---

## Part A — MoA research lineage (sources 1–4)

### A1. MoA — collaborativeness, dense layers  
**Wang et al., 2024 · Together / Duke / Stanford / Chicago**

- **Claim.** LLMs exhibit *collaborativeness*: they write better answers when shown other models’ drafts — even weaker ones. Stack that into layers without fine-tuning.
- **Mechanics.** Layer \(i\) has \(n\) agents \(A_{i,j}\).  
  \[
  y_i = \bigoplus_{j=1}^{n}[A_{i,j}(x_i)] + x_1,\quad x_{i+1}=y_i
  \]
  `⊕` = Aggregate-and-Synthesize prompt; `+` = concat; always re-attach original \(x_1\).
- **Roles.** *Proposers* (diverse drafts) vs *Aggregators* (merge). Same model can do both; specialization is real (e.g. WizardLM strong proposer / weak aggregator; Qwen strong aggregator).
- **Headline (mid-2024).** Open-only MoA ~**65.1%** AlpacaEval 2.0 LC vs GPT-4o **57.5%**. MoA-Lite (2 layers) still beats GPT-4o at lower cost. FLASK: +correctness/factuality/completeness; −conciseness (verbose).
- **Ablations that still matter.** Synthesize ≫ rank-only; more proposers help; **heterogeneous models > same model × n samples**; diversity is not optional theater.
- **Limits.** High TTFT (no first token until last layer); token/cost scale with layers×agents; fixed dense topology.

**Take for the lab:** default recipe = diverse proposers + strong final aggregator + re-inject user prompt every synthesize; start with 2 layers.

---

### A2. SMoA — sparse *messages* (Judge / Moderator / roles)  
**Li et al., 2024 · ASU et al. · arXiv:2411.03284**

Fixes MoA’s two pains: **token blowup** and **homogenization**.

| Mechanism | Agent | What it does |
|-----------|--------|----------------|
| Response selection | **Judge** | Top‑\(k\) keep after full generation (SMoE-style gate on *texts*) |
| Early stopping | **Moderator** | Stop rounds on quality / consensus / contentiousness |
| Role-playing | Processors | Distinct system roles → forced divergent thinking |

- **Eq shape.** Same MoA spine, but next context is only top‑\(k\) replies, not all \(n\).
- **\(k\) is non-monotonic.** Quality rises \(k=1→3\), then can drop at \(k=4\) (noise). Their sweet spot ≈ **\(k=3\)**.
- **Empirics.** SMoA ≈ MoA quality; ~**half** token cost in main setting (e.g. 1.75 vs 3.25); better CEB fairness/safety often; MAD unstable vs layer-based methods.
- **Critical honesty.** **All proposers still run every round.** Sparsity is on *what is passed forward*, not *who is activated*. Paper flags sparse activation as future work → leads to RouteMoA.

**Take:** keep Judge+Moderator+roles on MoA spine; sweep \(k\); don’t expect free quality wins over good MoA — expect iso-quality cheaper width scale.

---

### A3. RouteMoA — sparse *activation* (dynamic route)  
**Wang et al., ACL 2026 · SJTU / Tencent / Shanghai AI Lab / NTU · [2026.acl-long.558](https://aclanthology.org/2026.acl-long.558/)**

Answers SMoA’s open item: **don’t run the whole pool**.

**Dynamic route’s role (precise):**  
budgeted **casting director** each layer — chooses *which LLMs may generate* before paying inference, then updates beliefs from outputs.

| Stage | Component | Input | Output | Cost |
|-------|-----------|-------|--------|------|
| Prior (L1) | Lightweight **scorer** \(\mathcal{S}\) (e.g. mDeBERTa ~86M) | Query only | Coarse score vector over pool \(N\) | SLM only — **no pre-inference** of big models |
| Posterior (L≥2) | **Mixture of judges** | Prior + self-assessment + selective cross-assessment | Corrected scores | Near-free (piggyback on proposers; one cross grader) |
| Decision | **Model ranking** \(\mathcal{R}\) | scores, $, latency | Active set \(n_l \ll N\) | Rule: perf > out-token $ > in-token $ > latency |
| Stop | Threshold \(s_{th}\) | max score | Early final aggregate | Cuts depth |

- **Why it works.** Models specialize (math / code / biomed / general) → query-conditioned prior is informative (Fig. 1 style specialization plots). Multi-agent merge absorbs imperfect routing (unlike single-model routers).
- **Headline.** Large pool: **−89.8% cost, −63.6% latency** vs dense MoA-class; matches/beats accuracy; OOD + scale claims.
- **Failure mode.** Scorer *recall* miss (true specialist left out of top‑k) — posterior only partially heals.
- **Ops tax.** Scorer needs cheap retrain / new embedding when pool changes.

**Vs SMoA Judge**

| | SMoA Judge | RouteMoA router |
|--|------------|-----------------|
| Decides | Which *texts* forward | Which *models* speak |
| Full generate first? | Yes | **No** (main savings) |
| Large \(N\) | Still run all \(N\) | Run \(n \ll N\) |

**Take:** for multi-model menus, add a scorer+ranker *before* fan-out; treat routing as closed-loop across layers, not one-shot.

---

### A4. Faster-MoA — sparse *topology* + serving co-design  
**Wang, Qi, Chen, Wan, Sun, Li, Pei, Hao · Georgia Tech / PKU / Samsung · arXiv:2512.18126**

Moves from “algorithmic MoA” to **algorithm–system co-design** for real GPU serving (eval on H200).

**Three innovations**

1. **Hierarchical tree topology**  
   Replace all-to-all layers with clusters: each next-layer agent reads only a **local precursor cluster** \(|\mathcal{C}(a)| \ll |A_{\ell-1}|\) (example structure **9-3-1**).  
   Effects: less context, branch concurrency, stragglers isolated to subtrees, no full layer barrier.

2. **Semantic-guided runtime early-exit (EE)**  
   On-the-fly Frobenius-cosine similarity of embeddings + confidence (logprob geometric mean) → quality score \(Q\); prune / skip waiting on large models when small models already agree with high confidence.  
   Feasibility insight: width saturates accuracy while latency climbs; simple tasks don’t need the big stragglers.

3. **Dependency-aware incremental prefilling (PD overlap)**  
   Classic PD disaggregation assumes independent requests — **false under MoA deps**.  
   Stream precursor decode chunks into successor prefill; reuse KV on contiguous prefix+answer slots so dependent prefills hide behind upstream decode.  
   (Ordering caveat: non-contiguous answer slots still wait for earlier segments.)

**Headline.** **73–90% E2E latency↓** vs dense all-to-all MoA, accuracy within **±1%** (sometimes higher).

**Take:** once MoA leaves the API-collage phase, topology + early-exit + PD-aware scheduling dominate wall-clock; tree > dense for serving; EE should use *semantic agreement*, not only Moderator LLM votes.

---

### A5. Lineage comparison matrix

| Dimension | MoA | SMoA | RouteMoA | Faster-MoA |
|-----------|-----|------|----------|------------|
| Primary win | Quality via collab | Tokens / diversity | Who runs (activation) | E2E latency on GPU |
| Topology | Dense layers | Dense generate, sparse pass | Dynamic subset per layer | **Tree** clusters |
| Early stop | Fixed layers | Moderator LLM | Score threshold | Semantic+conf EE |
| Runs all models? | Yes | Yes | **No** | Cluster-local; EE may skip large |
| Hardware-aware | No | No | Cost/latency in rank | **PD overlap, multi-GPU** |
| Extra learned piece | None | None | Scorer SLM | Embedding sim metrics |
| Biggest residual pain | Cost, TTFT | Still full generate | Scorer miss / retrain | System complexity |

**Implementation ladder (suggested for Hermes MoA / hives)**

1. MoA-Lite spine (2 layers, diverse proposers, strong agg, re-inject \(x_1\)).  
2. + SMoA Judge \(k≈3\) + Moderator + optional roles.  
3. + RouteMoA-style prior shortlist from model cards / tiny scorer when pool > ~4.  
4. If self-hosting: tree fan-in + EE + incremental prefill on vLLM/SGLang-class stack.

---

## Part B — Production orchestration stack (sources 5–7)

These are not MoA algorithms; they are **how you ship multi-agent systems** without losing state, control, or debuggability.

### B5. LangGraph durable execution / persistence  
**Docs:** [durable-execution](https://docs.langchain.com/oss/python/langgraph/durable-execution) → [persistence](https://docs.langchain.com/oss/python/langgraph/persistence)

LangGraph’s pitch for agents: **orchestration runtime** with durable execution, streaming, HITL — not just “call an LLM.”

**Two persistence systems**

| | **Checkpointer** | **Store** |
|--|------------------|-----------|
| Persists | Graph state snapshots | App-defined KV |
| Scope | Single **thread** | **Cross-thread** |
| Memory | Short-term / working | Long-term facts, prefs |
| Use | Resume, HITL, time-travel, crash recovery | User memory, shared knowledge |
| Access | `thread_id` in config | Read/write from nodes |

**Durable execution meaning in practice**

- Checkpoint at node boundaries → mid-run failure resumes from last good node (not t=0).  
- **Durability modes** (perf vs safety): e.g. `async` (default, bg writes), `sync`, `exit` (persist only on exit/interrupt).  
- **Interrupts** + checkpointer = production HITL (pause days, resume same thread).  
- In-memory savers die on process restart → Postgres/SQLite for real durability.  
- Prune checkpoints or they grow without bound.  
- Subgraphs: need checkpointing for their own durable execution; shared cross-graph data → Store.

**MoA link.** Each MoA layer / Judge / Moderator / router step should be a **node** (or subgraph) with checkpoint boundaries so a failed aggregator doesn’t redo all proposers; parallel proposers = fan-out nodes; early-stop = conditional edge.

---

### B6. Ganji — orchestration patterns that survive production  
**[Agentic AI: Multi-Agent Orchestration Patterns with LangGraph](https://abhilashganji.com/research/agentic-ai-orchestration.html)** (2025)

Practice-backed patterns (EPAM-flavored):

| Pattern | Shape | Use when |
|---------|-------|----------|
| Sequential pipeline | A→B→C | Clear deps (research→analyze→write) |
| Router / supervisor | Classify → specialist | Heterogeneous request types |
| Parallel fan-out / fan-in | Decompose → many → synthesize | Independent subproblems (**MoA-shaped**) |
| Iterative refinement | Executor ⇄ critic loop (cap ~3) | Quality > latency (~+30–40% claimed with 2 critique rounds) |

**Hard rules that match MoA papers**

- Narrow scope, **≤~5 tools/agent**; tool descriptions are prompts.  
- Explicit typed state > agents “chatting.”  
- Memory tiers: working (graph state) / short-term (window+summary) / long-term (vector store).  
- HITL gates for high-stakes; escalate on low confidence.  
- Observability: traces (LangSmith-class), structured logs, **$/tokens per agent**, eval sets.  
- Start single-agent; multi-agent only when proven necessary.  
- Version prompts + topology.

**Framework notes (author’s):** LangGraph for production control; CrewAI for prototypes; AutoGen for conversational multi-agent; OpenAI Agents SDK clean but vendor-locked.

**MoA link.** MoA ≈ Pattern 3 (fan-out/fan-in) + optional Pattern 4 (multi-layer refine). RouteMoA ≈ supervisor/router over model pool. SMoA Judge/Moderator ≈ conditional edges + quality gates.

---

### B7. Sapkota et al. — LangChain vs LangGraph vs LangSmith taxonomy  
**TechRxiv 2025 · DOI [10.36227/techrxiv.175695645.52670060/v1](https://doi.org/10.36227/techrxiv.175695645.52670060/v1)** · [project](https://rashik.info.np/agentic_ai_toolchains/)

Survey / taxonomy for end-to-end agentic toolchains (not a new MoA algo).

**Layered roles**

| Tool | Layer | Job |
|------|-------|-----|
| **LangChain** | Build | Chains, tools, retrievers, memory; fast RAG/prototype; linear/DAG composition |
| **LangGraph** | Orchestrate | Stateful directed graphs; cycles; multi-agent; event-driven; adaptive control |
| **LangSmith** | Observe / eval / govern | Tracing, dashboards, eval pipelines, A/B, production monitoring |

**Taxonomy axes (paper):** state handling · control flow · orchestration · observability — plus planning/execution/monitoring lifecycle placement.

**Hybrid stack they endorse:** LangChain construct → LangGraph adaptively orchestrate → LangSmith continuously monitor/test/govern.  
Interoperability: shared state schemas, event buses, standardized telemetry; chain→graph conversion patterns.

**Proposed benchmark dimensions:** throughput, latency, scalability, memory behavior, **debugging resolution time** (developer-centric).

**Limits they flag:** complexity growth, state explosion, transparency gaps.  
**Future directions:** modular state abstraction, unified observability, ethics-by-design, **performance-aware routing**, auto-evaluation pipelines.

**MoA link.** Performance-aware routing (their future work) is exactly RouteMoA/Faster-MoA territory; LangSmith-style eval is how you prove MoA ablations in prod; don’t implement cyclic debate in pure LangChain chains — use graph orchestration.

---

## Part C — Unified mental model

### C1. What each layer optimizes

```
         ┌─────────────────────────────────────────┐
   QUALITY│  MoA collab + role diversity + synthesize│
         └──────────────────┬──────────────────────┘
   MESSAGES│  SMoA top-k + moderator depth control   │
         └──────────────────┬──────────────────────┘
 ACTIVATION│  RouteMoA scorer + rank (who wakes)     │
         └──────────────────┬──────────────────────┘
  TOPOLOGY │  Faster-MoA tree clusters + semantic EE │
  + SERVE  │  + incremental PD overlap on GPUs       │
         └──────────────────┬──────────────────────┘
  RUNTIME  │  LangGraph nodes, checkpoints, interrupts│
  + OPS    │  Ganji patterns + Sapkota toolchain split│
         └─────────────────────────────────────────┘
```

### C2. Design defaults (opinionated, for this lab)

| Choice | Default | Why |
|--------|---------|-----|
| Layers | 2 (Lite); 3 only async/high-stakes | TTFT + $ |
| Proposers | 3–6 **diverse** models/roles | Table: multi > single×n |
| Keep \(k\) | 3 | SMoA hump curve |
| Aggregator | Strong generalist (Qwen-class / frontier) | Role tables |
| Routing | Model cards + cheap prior if pool large | RouteMoA |
| Topology (self-host) | Tree 9-3-1-ish, not all-to-all | Faster-MoA |
| Early exit | Consensus + conf (+ semantic sim if embedded) | SMoA + Faster-MoA |
| Orchestration | Explicit graph state machine | Ganji / LangGraph |
| Durability | Postgres checkpointer + Store for cross-thread | LangGraph docs |
| Observability | Trace every agent; $/agent; fixed eval set | Ganji + LangSmith tax. |
| HITL | Interrupt before irreversible side effects | Prod requirement |

### C3. Anti-patterns

- Dense all-to-all “just add more agents” (accuracy saturates, latency doesn’t).  
- Rank-only fusion (MoA beats pure pick-best).  
- Same model sampled \(n\) times and calling it diversity.  
- Full-pool inference then filter (SMoA trap at large \(N\)).  
- Implicit agent chat with no typed state.  
- In-memory checkpoints in production.  
- 15+ tools on one agent.  
- No token budget per agent/step.  
- Building cyclic multi-agent only in linear chains.

---

## Part D — Mapping to Hermes / on-prem

| Hermes concept | Pull from |
|----------------|-----------|
| MoA / mixture-of-agents presets, hives | MoA + SMoA spine |
| Software-first before hardware scale | MoA→SMoA→Route before Faster-MoA GPU work |
| Model menu with specialists | RouteMoA scorer priors from specialization |
| On-prem node (A6000 / multi-model) | Faster-MoA tree + PD overlap ideas on local serve |
| Session continuity / park / leave-off | Checkpointers (thread) + Store (durable facts) |
| TG primary, long jobs | Durable runs + interrupts; don’t block UX on full MoA TTFT — stream Lite path |
| Cost consciousness | Rank by perf then $ then latency; EE; \(k\) |

---

## Part E — Open questions (park for later)

1. Self-MoA-style “best model × samples” vs true diversity — when does RouteMoA’s specialist prior dominate?  
2. True sparse *activation* inside a single serving engine (not only API multi-model).  
3. Scorer maintenance cost vs rule-based model cards for small pools.  
4. Semantic EE thresholds portable across domains without retune?  
5. Minimal LangGraph graph that encodes RouteMoA+SMoA with durable checkpoints and $/trace.  
6. Where debate (MAD) still wins over layer MoA (if anywhere) under modern reasoners.

---

## Quick citation block

```
MoA:        Wang et al. 2024. arXiv:2406.04692
SMoA:       Li et al. 2024. arXiv:2411.03284
RouteMoA:   Wang et al. 2026. ACL 2026. anthology 2026.acl-long.558
Faster-MoA: Wang et al. 2025. arXiv:2512.18126
LangGraph:  LangChain docs — Persistence / durable execution
Ganji:      2025. abhilashganji.com/research/agentic-ai-orchestration.html
Toolchains: Sapkota, Shrestha, Rijal, Karkee 2025. TechRxiv 10.36227/techrxiv.175695645.52670060/v1
```

---

*End of RESEARCH.md — living note; patch when MoA-lab experiments contradict a claim.*
