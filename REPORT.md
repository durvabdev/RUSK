## 1. Architecture

RUSK is a computer-use automation system for applications where the UI is effectively the integration surface. The core design is to use an LLM to discover how to complete a workflow once, then compile the successful run into a deterministic capability that can be replayed without the model in the decision loop.

Discovery runs are orchestrated with LangGraph. The main loop is:

OBSERVE
→ CHECK_PROGRESS
→ DECIDE
→ GUARD
→ EXECUTE
→ OBSERVE

DECIDE may also return FINISH or HUMAN. FINISH is verified before the run is considered successful, while HUMAN pauses automation and allows intervention in the existing browser session.

Playwright MCP is the execution surface for browser actions such as click, type, select, navigation, and keyboard input. MCP accessibility snapshots provide the fresh element references used for actions. I also use Chrome DevTools Protocol (CDP) as a second perception channel for richer semantic and DOM information. CDP data is used for perception only. A BrowserController abstraction separates browser execution from agent orchestration, while a ToolRegistry exposes the actions available to the model. Browser mutations are serialized because RUSK owns a single headed Chromium session.

A deterministic CHECK_PROGRESS node sits outside model reasoning. It compares normalized recent browser states and detects repeated mutations that make no meaningful progress. Semantic completion is still decided by the model; operational safeguards such as no-progress detection, policy enforcement, and runtime limits are deterministic.

The main trade-off is deliberate: discovery is relatively expensive and probabilistic, but successful workflows are converted into cheaper, reviewable, deterministic capabilities for repeated execution.

## 2. Artifact schema

A successful discovery run is compiled into a typed, versioned JSON artifact. The artifact is not the raw model transcript or a literal browser trace; it is a reusable capability contract.

Each artifact contains:

- metadata such as id, version, name, description, and source run;
- an entry URL and authentication requirement;
- typed input parameters;
- ordered replay steps;
- semantic target descriptors;
- typed outputs and deterministic extractors;
- explicit business/recoverable conditions;
- a success checkpoint.

For example, the member lookup capability accepts a `member_id_or_name_query`, searches for the member, opens the matching result, then extracts fields such as member ID, email, phone, and address.

Targets are stored semantically rather than using ephemeral MCP refs. A target may contain properties such as:

- testId
- role
- accessible name
- text
- href
- contextual scope (`within`)

For example, a `View Member` link can be scoped to the result container matching the input member query. This is more robust than storing an observation-local reference such as `f7e37`.

Inputs may come from explicit discovery actions or from meaningful configurable form controls observed during the successful workflow. This matters for defaulted fields: if a cheque-book form defaults to `Standard`, the resulting capability should expose `chequeBookType` as an overridable input rather than accidentally compiling a capability that only issues Standard cheque books.

Conditions are also part of the capability contract. For example:

`No members found`
→ `business_outcome`
→ `member_not_found`

This lets deterministic replay distinguish a valid negative business result from an unexpected missing target.

The artifact is therefore best viewed as a compiled and reviewable capability, not simply a recording.

## 3. Determinism & error handling

Replay is a separate execution path from discovery:

artifact + inputs
→ current browser observation
→ deterministic target resolution
→ fresh MCP ref
→ execute action
→ checkpoint/output extraction
→ structured result

Replay does not invoke an LLM or return to the DECIDE node.

Targets are resolved against the current browser state on every step. Old MCP refs are never persisted or reused. Resolution fails closed:

- exactly one target → execute;
- zero targets → `target_missing`;
- multiple targets → `target_ambiguous`.

Before treating a missing target as an unexpected error, replay checks the artifact's declared conditions. This distinction is important. For example:

`No members found`
→ declared `member_not_found`
→ terminal business outcome

whereas:

expected `View Member` is absent
+ no declared business condition matches
→ unexpected recoverable state
→ HUMAN escalation

The replay contract distinguishes three broad classes:

1. Business outcomes: the application behaved correctly, but the requested business result is negative, such as `member_not_found`.
2. Recoverable conditions: deterministic replay cannot safely continue, but the current browser session may be repairable.
3. Hard failures: malformed artifacts, invalid inputs, unsupported actions, policy violations, failed checkpoints, or other states where replay should terminate.

Replay also verifies a declared checkpoint before returning success and extracts only explicitly declared outputs.

Discovery has a separate no-progress mechanism. Browser observations are normalized to remove ephemeral refs and volatile values while preserving meaningful business state. Repeated state-changing actions that leave the environment unchanged trigger escalation rather than an unbounded retry loop.

## 4. Heterogeneity & multi-tenant

The current implementation targets a browser, but the artifact is intentionally not defined as raw Playwright code or CSS selectors. The seam is the surface/controller layer: artifacts describe semantic actions and targets, while the surface implementation determines how those targets are perceived and acted upon.

A legacy web adapter could combine accessibility information, DOM heuristics, frames, table structure, or coordinates while preserving the same artifact contract. A desktop adapter could expose equivalent operations through OS accessibility or desktop automation APIs.

For multi-tenant reuse, I would separate a canonical vendor-level artifact from tenant-specific overlays.

The base artifact contains the shared workflow semantics:

- capability inputs and outputs;
- ordered steps;
- canonical target descriptions;
- business condition codes;
- checkpoints.

A tenant overlay contains only that tenant's differences, such as:

- deployment base URL;
- alternate UI wording;
- narrowly scoped target overrides;
- tenant-specific variants of known conditions.

For example, the base capability may define:

`member_not_found`
→ text: `No members`

while a tenant overlay may define the same condition as:

`No results found`

Before replay, I would resolve:

base artifact
+ tenant overlay
→ effective artifact

The replay engine would then receive a normal WorkflowArtifact and remain completely tenant-agnostic.

I would key overrides by stable semantic identifiers such as condition codes and step IDs rather than array indexes. If the same tenant-specific variation begins appearing across multiple tenants, that is a signal that it may represent a vendor-version change and should be promoted into the canonical/vendor-version definition rather than duplicated indefinitely.

## 5. Escalation & handoff

Human escalation exists for states where autonomous execution cannot safely continue.

During discovery, the credential guard detects authentication-related fields before sensitive values pass through the normal model/tool path. Automation pauses and the human interacts directly with the same headed Chromium session. Resume returns through OBSERVE so the agent reasons from the new browser state rather than retrying a stale action.

CHECK_PROGRESS provides another discovery escalation path. Repeated mutations with no meaningful browser-state change are detected deterministically and routed to HUMAN rather than allowing an infinite agent loop.

Replay uses the same principle but does not invoke an AI agent.

A replay run stores its current artifact, inputs, step index, status, and last recoverable error. When a recoverable step fails:

replay
→ save current stepIndex
→ status = waiting_for_human
→ transfer browser control to HUMAN
→ return intervention request

The browser remains open on the exact session where replay stopped.

The human repairs the browser state manually. For example, they may correct a search query, dismiss an unexpected dialog, or restore an authenticated session. When the user clicks Resume Replay, RUSK:

1. reloads the saved replay run;
2. reuses the same live browser session;
3. observes the current browser state;
4. retries the same artifact step;
5. resolves a fresh target ref;
6. continues deterministic replay.

Replay does not restart at step zero and never reuses the stale ref from before intervention.

The contract for the current implementation is intentionally simple: the human repairs the environment; deterministic replay remains responsible for performing the failed artifact step.

## 6. Safety

RUSK exposes a restricted set of browser operations rather than arbitrary JavaScript execution. Policy checks occur before actions are executed and provide a place to enforce domain, route, action, and risk restrictions.

Credential handling is separated from normal model/tool execution. Credential fields trigger HUMAN intervention so credentials can be entered directly into the live browser session rather than being placed into model context or persisted in artifacts.

Artifacts contain semantic target information and parameterized workflow data, but do not store credentials, session secrets, CSRF values, raw model transcripts, or stale browser refs. Hidden/token-like inputs are excluded from useful replay inputs and should be redacted from perception/evidence.

Replay also fails closed rather than guessing when target resolution is ambiguous.

Risky state-changing actions are treated more conservatively than read-only observation. Successful transactional evidence is surfaced to discovery so the agent can terminate rather than repeat a completed operation, while repeated no-progress mutations are stopped by CHECK_PROGRESS.

The current policy system is intentionally smaller than a production banking authorization framework. A production version would add institution-specific policy configuration, explicit approval requirements for irreversible capabilities, stronger audit identity, and more granular PII redaction.

## 7. Cuts

I prioritized an end-to-end vertical slice over production infrastructure.

I deliberately did not build:

- a production co-browsing/operator console;
- native desktop automation;
- distributed workers, queues, or orchestration infrastructure;
- production multi-tenant persistence;
- open-ended LLM recovery during replay;
- fuzzy selector guessing;
- automatic self-healing artifacts;
- a complete artifact approval/version-management system;
- automatic discovery of every possible business outcome;
- a full visual/coordinate fallback.

The most important limitation is that a successful discovery run only observes the successful path. It cannot automatically know every valid negative business state it never encountered. The artifact therefore acts as a reviewed capability contract: the compiler derives the executable workflow, while known business outcomes and recoverable conditions can be added as explicit capability semantics.

With more time, I would deepen the deterministic path rather than add more agent autonomy: richer checkpoint types, more complete business-outcome definitions, vendor-version and tenant overlays, artifact approval states, replay stability metrics, and a second surface adapter for a hostile legacy web or desktop application.