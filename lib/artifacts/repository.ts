import fs from "node:fs/promises";
import path from "node:path";
import type { WorkflowArtifact } from "./schema";
import { WorkflowArtifactSchema } from "./schema";

export const ARTIFACTS_DIR = path.join(process.cwd(), ".rusk", "artifacts");

async function ensureDir() {
  await fs.mkdir(ARTIFACTS_DIR, { recursive: true });
}

export interface ArtifactRepository {
  save(artifact: WorkflowArtifact): Promise<void>;
  get(id: string): Promise<WorkflowArtifact | null>;
  list(): Promise<WorkflowArtifact[]>;
}

export function createArtifactRepository(): ArtifactRepository {
  return {
    async save(artifact) {
      await ensureDir();
      const parsed = WorkflowArtifactSchema.parse(artifact);
      const file = path.join(ARTIFACTS_DIR, `${parsed.id}.json`);
      await fs.writeFile(file, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    },

    async get(id) {
      await ensureDir();
      const file = path.join(ARTIFACTS_DIR, `${id}.json`);
      try {
        const raw = await fs.readFile(file, "utf8");
        return WorkflowArtifactSchema.parse(JSON.parse(raw));
      } catch {
        return null;
      }
    },

    async list() {
      await ensureDir();
      const entries = await fs.readdir(ARTIFACTS_DIR);
      const artifacts: WorkflowArtifact[] = [];
      for (const name of entries) {
        if (!name.endsWith(".json")) continue;
        try {
          const raw = await fs.readFile(path.join(ARTIFACTS_DIR, name), "utf8");
          artifacts.push(WorkflowArtifactSchema.parse(JSON.parse(raw)));
        } catch {
          // Skip legacy/invalid files (e.g. missing required checkpoint).
        }
      }
      return artifacts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
  };
}
