# Evidence: update member info

Capability: change a member’s contact details (`change_info` artifact). Traces and screenshots from discovery and replay.

## Files

- **artifact.json** — Compiled workflow artifact from discovery. Deterministic replay executes this JSON (steps, inputs, conditions, checkpoint, outputs).

- **discovery-run.jsonl** — LLM discovery run that produced the artifact. Goal: change Priya Nair’s email. Contains `runType: "discovery"`, `decisionMode: "llm"`, `decision` / `observation` / `action_result`, then `artifact_compiled` and `run_finished`.

- **successful-replay.jsonl** — Happy-path deterministic replay of the artifact. `decisionMode: "deterministic"` with `step_started` / `target_resolution` / `policy_check` / `step_finished`, then `checkpoint`, `outputs_extracted`, `replay_finished: success`. No LLM `decision` events.

- **replay-member-not-found.jsonl** — Replay with a non-matching member query (`priya naik`). Hits declared condition `member_not_found` (`condition_detected` → `business_outcome`). Terminates without HUMAN escalation.

- **transfer-to-human-missing-info.jsonl** — Replay started without a member query; `View Member` fails (`target_missing`) → `human_escalation` → `human_control: transfer_to_human`. After the human supplies a member id and resumes (`human_control: resume_automation`, `replay_resumed`), deterministic recovery continues and the run finishes successfully.

- **langsmith-trace.png** — Screenshot of the LangSmith trace for the discovery (LLM) run.

- **replay-ui.png** — Screenshot of the RUSK UI during / after a replay run. After discovery run, no traces shows that ni LLM was called.

- **business-outcome.png** — Screenshot of the browser when replay ends as `member_not_found` (no matching member).

- **human-adds-memberid.png** — Screenshot of the human correcting the live browser (entering a member id) while replay is `waiting_for_human`.
