import { NextResponse } from "next/server";
import { getBrowser } from "@/lib/browser/playwright-mcp-browser";

export const runtime = "nodejs";

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

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error();
    }
  } catch {
    return NextResponse.json(
      { error: "url must be a valid http(s) URL" },
      { status: 400 },
    );
  }

  const id = crypto.randomUUID();
  try {
    const browser = getBrowser();
    await browser.navigate(url);
    const { snapshot } = await browser.observe();
    return NextResponse.json(
      { id, url, goal, status: "created", snapshot },
      { status: 201 },
    );
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { id, url, goal, status: "failed", error },
      { status: 201 },
    );
  }
}
