# Multi-Turn Chat Application

A full-stack chat application: **NestJS** backend with SSE streaming and tool calling, **Next.js 14+ App Router** frontend with optimistic UI, a **BFF proxy** Route Handler, and **Google Gemini** as the LLM.

---

## Running Locally

### Prerequisites

- Node.js 18+
- pnpm (`npm install -g pnpm`)
- A Google Gemini API key — get one at [aistudio.google.com](https://aistudio.google.com)

### 1 · Environment variables

```bash
cp env.example .env
```

Open `.env` and set:

```env
LLM_API_KEY=your_gemini_api_key_here
LLM_MODEL=gemini-2.5-flash
```

### 2 · Start the backend

```bash
cd be
pnpm install
pnpm start:dev
# Listening on http://localhost:3000
```

### 3 · Start the frontend

Open a second terminal:

```bash
cd fe
pnpm install
pnpm dev
# Listening on http://localhost:3001
```

Open **http://localhost:3001** — the page creates a session automatically and renders the chat UI.

### Docker (alternative)

Requires Docker Desktop running.

```bash
cp env.example .env   # fill in LLM_API_KEY
docker compose up --build
```

- Backend → http://localhost:3000
- Frontend → http://localhost:3001

The frontend service waits for the backend health-check before starting.

---

## Test Scenarios

### Automated tests

```bash
# Backend unit tests (Jest + NestJS testing utilities)
cd be && pnpm test

# Frontend unit tests (Jest + @testing-library/react)
cd fe && pnpm test
```

### API test scenarios (curl)

Run these against the local backend (`http://localhost:3000`) or the deployed instance.

#### Setup — create a session

```bash
SESSION=$(curl -s -X POST http://localhost:3000/chat/session | jq -r '.sessionId')
echo "Session: $SESSION"
```

---

#### Scenario 1 — Plain domain knowledge (no tool call)

```bash
curl -N -X POST "http://localhost:3000/chat/$SESSION/message" \
  -H "Content-Type: application/json" \
  -d '{"message": "What are the key steps to making a good risotto?"}'
```

Expected: streaming tokens with risotto advice. No tool call triggered.

---

#### Scenario 2 — Tool call: `lookup_recipe`

```bash
curl -N -X POST "http://localhost:3000/chat/$SESSION/message" \
  -H "Content-Type: application/json" \
  -d '{"message": "What ingredients do I need for chocolate chip cookies?"}'
```

Expected: Gemini calls `lookup_recipe("chocolate chip cookies")` internally, then streams the structured ingredient list. Tool resolution happens server-side before the first token arrives.

---

#### Scenario 3 — Tool call: `run_typescript_code`

```bash
curl -N -X POST "http://localhost:3000/chat/$SESSION/message" \
  -H "Content-Type: application/json" \
  -d '{"message": "Can you calculate 2 to the power of 10 using TypeScript?"}'
```

Expected: Gemini calls `run_typescript_code("Math.pow(2, 10)")`, gets `1024`, then streams the answer.

---

#### Scenario 4 — Tool call: `get_department_info`

```bash
curl -N -X POST "http://localhost:3000/chat/$SESSION/message" \
  -H "Content-Type: application/json" \
  -d '{"message": "Tell me about the Engineering department"}'
```

Expected: Gemini calls `get_department_info("Engineering")` and streams department details (head, team size, responsibilities).

---

#### Scenario 5 — Off-topic refusal

```bash
curl -N -X POST "http://localhost:3000/chat/$SESSION/message" \
  -H "Content-Type: application/json" \
  -d '{"message": "What do you think about the latest election results?"}'
```

Expected:
```
I'm sorry, but I can only help with cooking recipes, programming questions, and company information.
```

Refusals are enforced via the system prompt **and** by inspecting `finish_reason === 'SAFETY'` server-side.

---

#### Scenario 6 — Multi-turn memory

```bash
# Turn 1
curl -N -X POST "http://localhost:3000/chat/$SESSION/message" \
  -H "Content-Type: application/json" \
  -d '{"message": "What ingredients do I need for spaghetti carbonara?"}'

# Turn 2 — refers back to the previous answer
curl -N -X POST "http://localhost:3000/chat/$SESSION/message" \
  -H "Content-Type: application/json" \
  -d '{"message": "How long does it take to cook?"}'
```

Expected: the second response uses context from turn 1 without needing to re-specify the dish.

Verify history is stored:

```bash
curl http://localhost:3000/chat/$SESSION/history | jq '.turns | length'
# Should be 2
```

---

#### Scenario 7 — Error cases

```bash
# 400 — empty message
curl -X POST "http://localhost:3000/chat/$SESSION/message" \
  -H "Content-Type: application/json" \
  -d '{"message": ""}'
# {"statusCode":400,"message":["message should not be empty"],...}

# 404 — unknown session
curl -X POST "http://localhost:3000/chat/bad-id/message" \
  -H "Content-Type: application/json" \
  -d '{"message": "hello"}'
# {"statusCode":404,...}

# 410 — expired session (set SESSION_TIMEOUT_MS = 5000 in session.service.ts to test quickly)
# After timeout:
curl "http://localhost:3000/chat/$SESSION/history"
# {"statusCode":410,...}
```

---

#### Scenario 8 — Rate limiting

```bash
for i in $(seq 1 11); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST "http://localhost:3000/chat/$SESSION/message" \
    -H "Content-Type: application/json" \
    -d '{"message": "ping"}'
done
# First 10: 200, 11th: 429
```

---

#### Scenario 9 — Health check

```bash
curl http://localhost:3000/health
# {"status":"ok","timestamp":"...","uptime":42.1,"memory":{...}}
```

---

## Architecture

### Backend (NestJS · `be/`)

| Module | Responsibility |
|---|---|
| `SessionModule` | In-memory session store, 30-min idle expiry, injectable clock |
| `ChatModule` | SSE streaming endpoint, delegates to LlmService |
| `LlmModule` | Google Gemini integration, tool-call loop, system-prompt enforcement |
| `HealthModule` | `GET /health` |
| `HttpExceptionFilter` | Uniform JSON error shape |
| `RateLimitGuard` | ≤ 10 req/min per IP |

**SSE protocol** (`POST /chat/:sessionId/message`):

```
data: {"token":"..."}                       ← one per chunk
data: {"done":true,"turnIndex":N}           ← stream close
data: {"error":"LLM unavailable"}           ← on mid-stream failure
```

Tool calls are fully resolved (tool_use → handler → tool_result → final response) **before** the first token is streamed.

### Frontend (Next.js 14+ App Router · `fe/`)

```
app/page.tsx               ← Server Component: reads cookie, fetches history, passes initialMessages
app/api/session/route.ts   ← Route Handler: creates NestJS session, sets HTTP-only cookie
app/api/chat/route.ts      ← BFF Route Handler: proxies NestJS SSE stream
components/ChatBox.tsx     ← 'use client': streaming UI, useOptimistic, SSE reader
```

### BFF Proxy design decision

The BFF Route Handler (`app/api/chat/route.ts`) keeps the NestJS origin URL and LLM key off the browser:

1. Reads `sessionId` from the **HTTP-only cookie** (inaccessible to JavaScript)
2. Forwards the request to NestJS using the server-only `API_URL` env var
3. Pipes the `ReadableStream` directly with zero buffering
4. Translates 404/410 from NestJS into `{ sessionExpired: true }` so the client can reload cleanly

---

## API Reference

### NestJS endpoints

| Method | Path | Success | Errors |
|---|---|---|---|
| `POST` | `/chat/session` | 201 `{ sessionId }` | — |
| `POST` | `/chat/:id/message` | 200 SSE stream | 400, 404, 410 |
| `GET` | `/chat/:id/history` | 200 `{ turns }` | 404, 410 |
| `DELETE` | `/chat/:id` | 204 | 404 |
| `GET` | `/health` | 200 `{ status, uptime, memory }` | — |

### Next.js Route Handlers

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/session` | Create session + set cookie + redirect to `/` |
| `POST` | `/api/session` | Create session + set cookie (called after expiry) |
| `DELETE` | `/api/session` | Clear session cookie |
| `POST` | `/api/chat` | BFF: proxy SSE stream from NestJS |

---

## Bonus features implemented

- **Rate limiting** — `RateLimitGuard`: ≤ 10 req/min per IP, returns 429 with `Retry-After`
- **Health check** — `GET /health` with uptime and memory stats; used as Docker health-check
- **Auto-scroll** — scrolls to the latest message on each new token
- **Disable Send in-flight** — button disabled while `isPending` (React transition)
- **Enter to submit** — `onKeyDown` handler on the input
- **Relative timestamps** — `Intl.RelativeTimeFormat` ("2 minutes ago")
- **Streaming cursor** — blinking `|` on the live bot bubble; removed on `done`
- **Docker Compose** — `docker compose up` starts both services; frontend waits for backend health-check
