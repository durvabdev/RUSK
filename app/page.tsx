"use client";

import { FormEvent, useEffect, useState } from "react";

type Run = {
  runId: string;
  url: string;
  goal: string;
  status: string;
  result?: string | null;
  snapshot?: string;
  error?: string;
  artifactId?: string;
  artifactError?: string;
};

export default function Home() {
  const [targetUrl, setTargetUrl] = useState("");
  const [goal, setGoal] = useState("");
  const [run, setRun] = useState<Run | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [formError, setFormError] = useState("");
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const current = document.documentElement.dataset.theme;
    if (current === "light" || current === "dark") setTheme(current);
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("theme", next);
    setTheme(next);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = targetUrl.trim();
    const nextGoal = goal.trim();
    if (!url && !nextGoal) {
      setFormError("Enter a target URL and a goal.");
      return;
    }
    if (!url) {
      setFormError("Enter a target URL.");
      return;
    }
    if (!nextGoal) {
      setFormError("Enter a goal.");
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      setFormError("Enter a valid http(s) URL.");
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      setFormError("Enter a valid http(s) URL.");
      return;
    }

    setFormError("");
    setRunning(true);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, goal: nextGoal }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(data.error || `Request failed (${res.status})`);
        return;
      }
      setRun(data);
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="wrap">
      <div className="top">
        <h1>RUSK</h1>
        <button type="button" className="theme-toggle" onClick={toggleTheme}>
          {theme === "dark" ? "LIGHT" : "DARK"}
        </button>
      </div>
      <form onSubmit={onSubmit}>
        <label htmlFor="target-url">Target URL</label>
        <input
          id="target-url"
          type="text"
          value={targetUrl}
          onChange={(e) => setTargetUrl(e.target.value)}
        />

        <label htmlFor="goal">Goal</label>
        <textarea
          id="goal"
          rows={4}
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
        />

        <button type="submit" disabled={running}>
          {running ? "Running…" : "Run Agent"}
        </button>
        {formError ? (
          <p className="form-error" role="alert">
            {formError}
          </p>
        ) : null}
      </form>

      {run ? (
        <div className="result">
          <p className="label">Run ID</p>
          <p className="value">{run.runId}</p>
          <p className="label">Status</p>
          <p className="value">{run.status}</p>
          <p className="label">Target URL</p>
          <p className="value">{run.url}</p>
          <p className="label">Goal</p>
          <p className="value">{run.goal}</p>
          {run.result ? (
            <>
              <p className="label">Result</p>
              <p className="value">{run.result}</p>
            </>
          ) : null}
          {run.error ? (
            <>
              <p className="label">Error</p>
              <p className="value">{run.error}</p>
            </>
          ) : null}
          {run.artifactId ? (
            <>
              <p className="label">Artifact ID</p>
              <p className="value">{run.artifactId}</p>
            </>
          ) : null}
          {run.artifactError ? (
            <>
              <p className="label">Artifact error</p>
              <p className="value">{run.artifactError}</p>
            </>
          ) : null}
          {run.status === "success" && !run.artifactId && !run.artifactError ? (
            <>
              <p className="label">Artifact</p>
              <p className="value">
                Not attempted (unexpected — check API response)
              </p>
            </>
          ) : null}
          {run.snapshot ? (
            <>
              <p className="label">Snapshot</p>
              <pre className="snapshot">{run.snapshot}</pre>
            </>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
