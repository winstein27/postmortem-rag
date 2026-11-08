# postmortem-rag

RAG over public incident postmortems (Cloudflare first): ask a question, get an answer grounded only in retrieved postmortem excerpts, with links to the sources.

Public overview, design decisions, and roadmap: README.md. Tick the roadmap checkbox when a step is done.

## Architecture

- **Producer** (`src/producer.ts`): reads `data/urls.txt` and sends one message per postmortem URL to the `postmortem-ingest` queue.
- **Worker** (`src/worker.ts`): receives a message, downloads the page, extracts the text, splits it into chunks, creates embeddings, upserts the chunks into Postgres (pgvector) keyed by content hash, and only then deletes the message.
- **DLQ**: messages that fail 3 times go to `postmortem-ingest-dlq`.
- **Query API** (later): embeds the question, retrieves the closest chunks, asks the LLM to answer only from them, and returns the sources.

## Local stack

- `docker compose up -d`: Postgres + pgvector (port 5432) and ElasticMQ (SQS API on 9324). ElasticMQ has no web UI; use `npm run queue:stats` to see queue message counts.
- Configuration comes from environment variables (see `.env.example`): `DATABASE_URL`, `AWS_REGION`, `SQS_ENDPOINT`, `SQS_QUEUE_URL`. An empty `SQS_ENDPOINT` means real AWS SQS. Never hardcode endpoints or credentials.
- Commands: `npm run producer`, `npm run worker`.
- Tests: `npm run test:unit` (no Docker needed), `npm run test:integration` (needs the local stack running), `npm test` (both).

## Decisions

- Standard queue with at-least-once delivery, so the worker must be idempotent: processing the same message twice must not duplicate data.
- Visibility timeout 60 s: the worst case is about 40 s, given the timeouts on external calls (page download 10 s, embeddings API 30 s). Revisit with measured durations.
- `maxReceiveCount` 3: two retries for transient failures; permanent failures reach the DLQ without blocking the queue.
- Long polling (`receiveMessageWait` 20 s) to avoid empty receives.

## Working agreement

- I write the core logic myself: queue consumption (receive, process, delete), idempotency, retrieval, prompts and evaluation. Do not implement these unless I explicitly ask.
- You may scaffold, configure, write boilerplate, explain code, and review my code and suggest changes.
- Keep changes small and explain each one in plain terms. Ask before adding a dependency.
- TypeScript strict mode, ESM. Commit messages follow Conventional Commits.
- Everything in the repository is written in American English: code, identifiers, comments, log and error messages, test names, docs, config files, and commit messages.
