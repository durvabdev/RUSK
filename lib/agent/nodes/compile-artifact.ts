import type { ArtifactRepository } from "../../artifacts/repository";
import { compileArtifact } from "../../artifacts/compiler";
import { appendRunEvent, writeRunMeta } from "../../evidence/run-log";
import type { AgentState, AgentStateUpdate } from "../state";

export function createCompileArtifactNode(repo: ArtifactRepository) {
  return async function compileArtifactNode(
    state: AgentState,
  ): Promise<AgentStateUpdate> {
    if (state.status !== "success" || !state.recordArtifact) {
      await appendRunEvent(state.runId, {
        event: "discovery_finished",
        status: state.status,
        artifactId: null,
      });
      await appendRunEvent(state.runId, {
        event: "run_finished",
        runType: "discovery",
        status: state.status,
        artifactId: null,
      });
      await writeRunMeta(state.runId, {
        kind: "discovery",
        status: state.status,
      });
      return {};
    }

    try {
      const artifact = compileArtifact(state);
      await repo.save(artifact);
      await appendRunEvent(state.runId, {
        event: "artifact_compiled",
        artifactId: artifact.id,
      });
      await appendRunEvent(state.runId, {
        event: "discovery_finished",
        status: "success",
        artifactId: artifact.id,
      });
      await appendRunEvent(state.runId, {
        event: "run_finished",
        runType: "discovery",
        status: "success",
        artifactId: artifact.id,
      });
      await writeRunMeta(state.runId, {
        kind: "discovery",
        status: "success",
        artifactId: artifact.id,
      });
      return { artifactId: artifact.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await appendRunEvent(state.runId, {
        event: "discovery_finished",
        status: "error",
        artifactId: null,
        error: message,
      });
      await appendRunEvent(state.runId, {
        event: "run_finished",
        runType: "discovery",
        status: "error",
        artifactId: null,
        error: message,
      });
      await writeRunMeta(state.runId, {
        kind: "discovery",
        status: "error",
      });
      return {
        artifactError: message,
      };
    }
  };
}
