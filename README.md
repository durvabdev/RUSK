# RUSK

## Run locally

```bash
npm install
cp .env.example .env
npx playwright install chromium
npm run dev
```

RUSK owns a dedicated Chromium at `.rusk-browser/` (not your personal Chrome
profile). Playwright MCP and a CDP inspector both attach to that process.
Optional: `RUSK_CDP_PORT`, `RUSK_HEADLESS=true`.

## LangSmith tracing

Add your key to `.env` and keep the following enabled:

```dotenv
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=your_langsmith_key
LANGSMITH_PROJECT=rusk
LANGCHAIN_CALLBACKS_BACKGROUND=false
```

Each browser-agent request appears in LangSmith as `rusk-agent-run`. Its trace
includes the LangGraph nodes (`observe`, `decide`, and `execute`), model calls,
and the tool name, arguments, and result recorded by the `execute` node.

Set `LANGSMITH_ENDPOINT` only when using a regional or self-hosted LangSmith
deployment. Do not commit `.env`.
