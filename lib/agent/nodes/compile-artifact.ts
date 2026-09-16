import type { ArtifactRepository } from "../../artifacts/repository";
import { compileArtifact } from "../../artifacts/compiler";
import type { AgentState, AgentStateUpdate } from "../state";

export function createCompileArtifactNode(repo: ArtifactRepository) {
  return async function compileArtifactNode(
    state: AgentState,
  ): Promise<AgentStateUpdate> {
    if (state.status !== "success" || !state.recordArtifact) {
      return {};
    }

    try {
      const artifact = compileArtifact(state);
      await repo.save(artifact);
      return { artifactId: artifact.id };
    } catch (err) {
      return {
        artifactError: err instanceof Error ? err.message : String(err),
      };
    }
  };
}
