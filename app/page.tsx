"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Run = {
  runId: string;
  url: string;
  goal: string;
  status: string;
  result?: string | null;
  snapshot?: string;
  error?: string;
  code?: string;
  artifactId?: string;
  artifactError?: string;
  humanRequest?: { type: string; message: string } | null;
};

type ArtifactInputDef = {
  type: "string";
  required: boolean;
  description?: string;
};

type ArtifactSummary = {
  id: string;
  name: string;
  description: string;
  startUrl: string;
  inputs: Record<string, ArtifactInputDef>;
};

type ArtifactRunResult =
  | { status: "success"; outputs: Record<string, string>; runId?: string }
  | {
      status: "business_outcome";
      code: string;
      message: string;
      runId?: string;
      context?: unknown;
    }
  | {
      status: "recoverable";
      code: string;
      message: string;
      retryable: true;
      runId?: string;
      context?: unknown;
    }
  | {
      status: "failure";
      code: string;
      message: string;
      runId?: string;
      context?: unknown;
    };

function originOf(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function humanizeKey(key: string): string {
  const words = key.split("_").filter(Boolean);
  if (words.length === 0) return key;
  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function displayName(artifact: ArtifactSummary): string {
  return humanizeKey(artifact.name);
}

export default function Home() {
  const [targetUrl, setTargetUrl] = useState("");
  const [goal, setGoal] = useState("");
  const [run, setRun] = useState<Run | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [formError, setFormError] = useState("");
  const [running, setRunning] = useState(false);
  const [hitlBusy, setHitlBusy] = useState(false);

  const [allArtifacts, setAllArtifacts] = useState<ArtifactSummary[]>([]);
  const [artifactsLoading, setArtifactsLoading] = useState(false);
  const [artifactsError, setArtifactsError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [replayRunningId, setReplayRunningId] = useState<string | null>(null);
  const [replayResults, setReplayResults] = useState<
    Record<string, ArtifactRunResult>
  >({});

  const siteOrigin = useMemo(() => originOf(targetUrl), [targetUrl]);

  const siteArtifacts = useMemo(() => {
    if (!siteOrigin) return [];
    return allArtifacts.filter((a) => originOf(a.startUrl) === siteOrigin);
  }, [allArtifacts, siteOrigin]);

  const loadArtifacts = useCallback(async () => {
    setArtifactsLoading(true);
    setArtifactsError("");
    try {
      const res = await fetch("/api/artifacts");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setArtifactsError(data.error || `Failed to load artifacts (${res.status})`);
        return;
      }
      setAllArtifacts(
        Array.isArray(data.artifacts) ? (data.artifacts as ArtifactSummary[]) : [],
      );
    } catch (err) {
      setArtifactsError(err instanceof Error ? err.message : String(err));
    } finally {
      setArtifactsLoading(false);
    }
  }, []);

  useEffect(() => {
    const current = document.documentElement.dataset.theme;
    if (current === "light" || current === "dark") setTheme(current);
  }, []);

  useEffect(() => {
    void loadArtifacts();
  }, [loadArtifacts]);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("theme", next);
    setTheme(next);
  }

  function toggleArtifact(artifact: ArtifactSummary) {
    if (expandedId === artifact.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(artifact.id);
    setInputValues((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(artifact.inputs)) {
        if (!(key in next)) next[key] = "";
      }
      return next;
    });
  }

  async function onRunWorkflow(artifact: ArtifactSummary) {
    const inputs: Record<string, string> = {};
    for (const [key, def] of Object.entries(artifact.inputs)) {
      const value = (inputValues[key] ?? "").trim();
      if (def.required && !value) {
        setReplayResults((prev) => ({
          ...prev,
          [artifact.id]: {
            status: "failure",
            message: `Missing required input: ${key}`,
            code: "input_invalid",
          },
        }));
        return;
      }
      inputs[key] = value;
    }

    setReplayRunningId(artifact.id);
    try {
      const res = await fetch(`/api/artifacts/${artifact.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputs }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      > & {
        status?: string;
        outputs?: Record<string, string>;
        message?: string;
        error?: string;
        code?: string;
        runId?: string;
        context?: unknown;
      };
      const runId = typeof data.runId === "string" ? data.runId : undefined;
      if (data.status === "success" && data.outputs) {
        setReplayResults((prev) => ({
          ...prev,
          [artifact.id]: {
            status: "success",
            outputs: data.outputs!,
            ...(runId ? { runId } : {}),
          },
        }));
      } else if (data.status === "business_outcome" && data.code && data.message) {
        setReplayResults((prev) => ({
          ...prev,
          [artifact.id]: {
            status: "business_outcome",
            code: String(data.code),
            message: String(data.message),
            ...(runId ? { runId } : {}),
            ...(data.context ? { context: data.context } : {}),
          },
        }));
      } else if (data.status === "recoverable" && data.code && data.message) {
        setReplayResults((prev) => ({
          ...prev,
          [artifact.id]: {
            status: "recoverable",
            code: String(data.code),
            message: String(data.message),
            retryable: true,
            ...(runId ? { runId } : {}),
            ...(data.context ? { context: data.context } : {}),
          },
        }));
      } else if (data.status === "failure" && data.code) {
        setReplayResults((prev) => ({
          ...prev,
          [artifact.id]: {
            status: "failure",
            code: String(data.code),
            message: String(data.message || data.error || "Replay failed"),
            ...(runId ? { runId } : {}),
            ...(data.context ? { context: data.context } : {}),
          },
        }));
      } else {
        setReplayResults((prev) => ({
          ...prev,
          [artifact.id]: {
            status: "failure",
            message: String(
              data.message || data.error || `Request failed (${res.status})`,
            ),
            code: String(data.code || "step_failed"),
            ...(runId ? { runId } : {}),
          },
        }));
      }
    } catch (err) {
      setReplayResults((prev) => ({
        ...prev,
        [artifact.id]: {
          status: "failure",
          message: err instanceof Error ? err.message : String(err),
          code: "step_failed",
        },
      }));
    } finally {
      setReplayRunningId(null);
    }
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
    if (!originOf(url)) {
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
      if (!res.ok && data.status !== "waiting_for_human") {
        setFormError(
          data.error || data.code
            ? `${data.code ? `${data.code}: ` : ""}${data.error || `Request failed (${res.status})`}`
            : `Request failed (${res.status})`,
        );
        if (data.runId) {
          setRun({
            runId: String(data.runId),
            url,
            goal: nextGoal,
            status: String(data.status || "failed"),
            error: data.error ? String(data.error) : undefined,
            code: data.code ? String(data.code) : undefined,
          });
        }
        return;
      }
      setRun(data as Run);
      if (data.artifactId) {
        await loadArtifacts();
      }
    } finally {
      setRunning(false);
    }
  }

  async function onHitl(action: "resume" | "cancel") {
    if (!run?.runId) return;
    setHitlBusy(true);
    setFormError("");
    try {
      const res = await fetch(`/api/runs/${run.runId}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(data.error || `Resume failed (${res.status})`);
        return;
      }
      setRun((prev) => ({
        ...(prev ?? { runId: run.runId, url: run.url, goal: run.goal }),
        ...(data as Run),
        runId: String(data.runId || run.runId),
        url: prev?.url ?? run.url,
        goal: prev?.goal ?? run.goal,
      }));
      if (data.artifactId) {
        await loadArtifacts();
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setHitlBusy(false);
    }
  }

  function focusNewWorkflow() {
    document.getElementById("goal")?.focus();
  }

  return (
    <main className="wrap">
      <div className="top">
        <h1>RUSK</h1>
        <button type="button" className="theme-toggle" onClick={toggleTheme}>
          {theme === "dark" ? "LIGHT" : "DARK"}
        </button>
      </div>

      <label htmlFor="target-url">URL</label>
      <input
        id="target-url"
        type="text"
        value={targetUrl}
        onChange={(e) => setTargetUrl(e.target.value)}
        placeholder="https://example.com/"
      />

      <section className="workflows">
        <h2 className="section-title">Existing workflows for this site</h2>
        <hr className="section-rule" />

        {!targetUrl.trim() ? (
          <p className="muted">Enter a URL to see saved workflows.</p>
        ) : !siteOrigin ? (
          <p className="form-error" role="alert">
            Enter a valid http(s) URL.
          </p>
        ) : artifactsLoading ? (
          <p className="muted">Loading workflows…</p>
        ) : artifactsError ? (
          <p className="form-error" role="alert">
            {artifactsError}
          </p>
        ) : siteArtifacts.length === 0 ? (
          <p className="muted">No saved workflows for this site yet.</p>
        ) : (
          <ul className="workflow-list">
            {siteArtifacts.map((artifact) => {
              const open = expandedId === artifact.id;
              const replay = replayResults[artifact.id];
              const replaying = replayRunningId === artifact.id;
              return (
                <li key={artifact.id} className="workflow-item">
                  <button
                    type="button"
                    className="workflow-toggle"
                    onClick={() => toggleArtifact(artifact)}
                    aria-expanded={open}
                  >
                    <span className="workflow-chevron">{open ? "▾" : "▸"}</span>
                    {displayName(artifact)}
                  </button>

                  {open ? (
                    <div className="workflow-panel">
                      {Object.entries(artifact.inputs).map(([key, def]) => (
                        <div key={key}>
                          <label htmlFor={`input-${artifact.id}-${key}`}>
                            {humanizeKey(key)}
                            {def.required ? "" : " (optional)"}
                          </label>
                          <input
                            id={`input-${artifact.id}-${key}`}
                            type="text"
                            value={inputValues[key] ?? ""}
                            placeholder={def.description || undefined}
                            onChange={(e) =>
                              setInputValues((prev) => ({
                                ...prev,
                                [key]: e.target.value,
                              }))
                            }
                          />
                        </div>
                      ))}
                      <button
                        type="button"
                        disabled={replaying}
                        onClick={() => void onRunWorkflow(artifact)}
                      >
                        {replaying ? "Running…" : "Run workflow"}
                      </button>

                      {replay ? (
                        <div className="replay-result">
                          {replay.runId ? (
                            <>
                              <p className="label">Replay runId</p>
                              <p className="value">{replay.runId}</p>
                            </>
                          ) : null}
                          <p className="label">Result</p>
                          <pre className="value" style={{ whiteSpace: "pre-wrap" }}>
                            {JSON.stringify(replay, null, 2)}
                          </pre>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <button type="button" className="new-workflow" onClick={focusNewWorkflow}>
        New workflow
      </button>

      <form onSubmit={onSubmit}>
        <label htmlFor="goal">Goal</label>
        <textarea
          id="goal"
          rows={4}
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
        />

        <button type="submit" disabled={running}>
          {running ? "Running…" : "Run agent"}
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
          {run.status === "waiting_for_human" && run.humanRequest ? (
            <div className="hitl">
              <p className="label">Human required ({run.humanRequest.type})</p>
              <p className="value">{run.humanRequest.message}</p>
              <p className="muted">
                Use the already-open browser while paused, then Resume or Cancel.
              </p>
              <div className="hitl-actions">
                <button
                  type="button"
                  disabled={hitlBusy}
                  onClick={() => void onHitl("resume")}
                >
                  {hitlBusy ? "Working…" : "Resume"}
                </button>
                <button
                  type="button"
                  disabled={hitlBusy}
                  onClick={() => void onHitl("cancel")}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
          {run.code ? (
            <>
              <p className="label">Code</p>
              <p className="value">{run.code}</p>
            </>
          ) : null}
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
