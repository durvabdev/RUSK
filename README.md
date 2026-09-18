Browser agent that discovers workflows, compiles artifacts, and replays them deterministically against a headed Chromium session.

## Prerequisites

- Node.js 22+ (matches `@types/node` in this repo)
- An OpenAI API key (agent uses `@langchain/openai`)

## Run locally

```bash
npm install
cp .env.example .env
npx playwright install chromium
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

Using the UI

Discovery: enter a goal (+ start URL as the UI requires). The agent observes/decides/guards/executes in the live browser. When it pauses for credentials, approval, or stuck progress, act in that same Chromium window, then resume in the UI.

Replay: after an artifact is compiled, use Run workflow on that artifact. On human/approval pauses, fix or confirm in the live browser, then resume replay

## Tests

npm test

## LangSmith Tracing

```
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=your_langsmith_key
LANGSMITH_PROJECT=rusk
LANGCHAIN_CALLBACKS_BACKGROUND=false
```
