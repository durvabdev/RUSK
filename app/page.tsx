"use client";

import { FormEvent, useState } from "react";

type Run = {
  id: string;
  url: string;
  goal: string;
  status: string;
};

export default function Home() {
  const [targetUrl, setTargetUrl] = useState("");
  const [goal, setGoal] = useState("");
  const [run, setRun] = useState<Run | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!targetUrl.trim() || !goal.trim()) return;

    const res = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: targetUrl, goal }),
    });
    const data = await res.json();
    if (!res.ok) return;
    setRun(data);
  }

  return (
    <main className="wrap">
      <h1>Rusk</h1>
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

        <button type="submit">Run Agent</button>
      </form>

      {run ? (
        <div className="result">
          <p>Run ID:</p>
          <p>{run.id}</p>
          <p>Status:</p>
          <p>{run.status}</p>
          <p>Target URL:</p>
          <p>{run.url}</p>
          <p>Goal:</p>
          <p>{run.goal}</p>
        </div>
      ) : null}
    </main>
  );
}
