import { NextResponse } from "next/server";

import { createArtifactRepository } from "@/lib/artifacts/repository";

export const runtime = "nodejs";

export async function GET() {
  const repo = createArtifactRepository();
  const artifacts = await repo.list();
  return NextResponse.json({
    artifacts: artifacts.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      startUrl: a.startUrl,
      requiresAuthenticatedSession: a.requiresAuthenticatedSession,
      inputs: a.inputs,
      createdAt: a.createdAt,
      sourceRunId: a.sourceRunId,
    })),
  });
}
