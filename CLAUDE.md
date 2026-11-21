# postmortem-rag

RAG over public incident postmortems (Cloudflare first): ask a question, get an answer grounded only in retrieved postmortem excerpts, with links to the sources.

Public overview, design decisions, known limitations, and roadmap: README.md. Tick the roadmap checkbox when a step is done, and update the README status line and project layout when files are added.

## Architecture

- **Producer** (`src/producer.ts`): reads `data/urls.txt` and sends one message per postmortem URL to the `postmortem-ingest` queue. Done.
- **Worker** (`src/worker.ts`): receives one message, downloads the page, extracts title, date, sections, and text, stores the document, splits it into chunks, creates embeddings, replaces the document's chunks in Postgres (pgvector), and only then deletes the message. In progress: download, extraction, and ack are done for one message per run; no loop yet, and nothing is stored.
- **DLQ**: messages that fail 3 times go to `postmortem-ingest-dlq`.
- **Query API** (next): `POST /ask` with Fastify. Embeds the question, retrieves the top 5 chunks, asks the LLM to answer only from them with `[n]` citations, and returns the sources.
- **Evaluation**: `npm run eval` runs the golden set and prints hit rate@5, MRR, valid citations, and correct refusals.

## Local stack

- `npm run infra:up`: Postgres + pgvector (5432) and ElasticMQ (SQS API on 9324). No web UI; `npm run queue:stats` shows message counts, including the DLQ.
- Configuration comes from environment variables validated in `src/config/env.ts` (see `.env.example`). An empty `SQS_ENDPOINT` means real AWS SQS. Never hardcode endpoints, credentials, or API keys.
- `docker/postgres/init.sql` runs only when the volume is created: after changing it, `docker compose down -v`.

## Commands

- `npm run producer`, `npm run worker`, `npm run smoke`, `npm run queue:stats`
- `npm run typecheck`
- `npm run test:unit` (no Docker, no network), `npm run test:watch`, `npm run test:integration` (needs the stack), `npm test` (both)

Before saying a task is done, run `npm run typecheck` and `npm run test:unit`, and report the result.

## Decisions

- Standard queue, at-least-once delivery, so the worker must be idempotent.
- Idempotency: `documents` has one row per URL (unique) with the content hash, the pipeline version, and the extracted text; `chunks` belong to a document. Same hash and pipeline version is a no-op; otherwise the document's chunks are replaced in one transaction. The pipeline version changes with the chunking rules or the embeddings model.
- The worker receives one message at a time (`maxMessages: 1`), because the 60 s visibility timeout is sized for one message (worst case about 40 s: download 10 s, one embeddings call 30 s).
- `maxReceiveCount` 3 and long polling (20 s).
- The queue is a system boundary: messages are validated with Zod on receive.
- LLM and embeddings providers sit behind interfaces, so they can be swapped (including for a local model).
- Build order: one end-to-end path first (worker, schema, extraction, chunking, embeddings, vector search, `POST /ask`), then evaluation, then hybrid search with RRF, then hardening.

## Working agreement

The rule: I write the core logic and the design decisions. You write the plumbing. When in doubt, ask which side a task is on.

**I write (do not implement unless I explicitly ask; review, explain, and suggest tests instead):**

- Worker loop: receive, parse, process, ack, and failure handling
- Idempotency: content hash, pipeline version, transactional replace of chunks
- Chunking (`src/ingest/chunk.ts`), with tests
- Provider interfaces (`EmbeddingsProvider`, `LlmProvider`): the types only
- Retrieval SQL: vector search, full-text search, RRF
- Prompts and citation parsing
- Evaluation metric functions (hit rate@5, MRR, citation validity, refusals) and the golden set questions
- The `ExtractedPage` type (the extraction contract)

**You may implement:**

- HTML extraction (`src/ingest/extract-page.ts`) with cheerio, against my `ExtractedPage` type, plus its tests
- SQL migrations and a minimal migration runner (I review the schema before it is applied)
- Provider adapters: the SDK calls behind my interfaces, batching, timeouts
- Fastify server scaffolding, route wiring, request/response validation
- The eval runner around my metric functions: loading the golden set, running the queries, printing the table, writing the results file
- Logging (Pino), CI (GitHub Actions), lint and formatting, scripts, Docker and config
- English polish of the README and comments

**How to work:**

- For changes across more than one file, show a short plan first and wait for my OK.
- Keep changes small and explain each one in plain terms. Do not commit; suggest a Conventional Commits message.
- Ask before adding a dependency. Pre-approved: `cheerio`, `fastify`, `pino`.
- Tests use `node:test` and `node:assert/strict` with `tsx`. Unit tests need no network or Docker: HTTP calls go to a local `node:http` server or a fake provider.
- Test fixtures must not contain real postmortem text (the texts are never committed). Use small synthetic HTML that mirrors the Cloudflare blog structure.
- No code, prompts, or data from other projects go into this repository.
- TypeScript strict mode, ESM. Everything in the repository is written in American English: code, identifiers, comments, log and error messages, test names, docs, config, and commit messages.
