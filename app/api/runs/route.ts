import { NextResponse } from "next/server";

export async function POST(request: Request) {
  let body: { url?: unknown; goal?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "url and goal are required" },
      { status: 400 },
    );
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  const goal = typeof body.goal === "string" ? body.goal.trim() : "";
  if (!url || !goal) {
    return NextResponse.json(
      { error: "url and goal are required" },
      { status: 400 },
    );
  }

  return NextResponse.json(
    { id: crypto.randomUUID(), url, goal, status: "created" },
    { status: 201 },
  );
}
