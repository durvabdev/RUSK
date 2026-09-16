import { NextResponse } from "next/server";

import { createArtifactRepository } from "@/lib/artifacts/repository";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const repo = createArtifactRepository();
  const artifact = await repo.get(id);

  if (!artifact) {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }

  return NextResponse.json(artifact);
}
