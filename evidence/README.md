# Evidence

Populate this directory with real runs via:

```bash
npm run evidence:export -- \
  --discovery-run <id> \
  --replay-success <id> \
  --replay-exception <id> \
  --artifact <artifactId>
```

Expected files after a successful export:

- `capability.json` — discovery artifact (verbatim)
- `discovery-run.jsonl`
- `replay-success.jsonl`
- `replay-exception.jsonl`
- `replay-exception.png` (optional)
- `README.md` (overwritten with run ids)
