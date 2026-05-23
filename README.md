# Multi-Turn Chat Application

A full-stack chat application: **NestJS** backend with SSE streaming and tool calling, **Next.js 14+ App Router** frontend with optimistic UI, a **BFF proxy** Route Handler, and **Google Gemini** as the LLM.

---

## Local Setup

### Prerequisites
- Node.js 18+
- pnpm
- A Google Gemini API key (Gemini 2.0 Flash or 2.5 Flash)

### 1 · Configure environment

```bash
cp env.example .env
# Fill in LLM_API_KEY with your Gemini key
```

### 2 · Install and run backend

```bash
cd be
pnpm install
pnpm start:dev        # http://localhost:3000
```

### 3 · Install and run frontend

```bash
cd ../fe
pnpm install
pnpm dev              # http://localhost:3001
```

Open **http://localhost:3001** — the Server Component reads or creates a session and passes initial history to the chat client.

---

## Docker

```bash
cp env.example .env   # add your LLM_API_KEY
docker compose up --build
```

- Backend → http://localhost:3000
- Frontend → http://localhost:3001

The `backend` service includes a health-check (`GET /health`); the `frontend` service waits for it before starting.

---

## Sample Q&A pairs

### 1 — Plain domain knowledge (cooking)

> **User:** What are the key steps to making a good risotto?
>
> **Assistant:** Great risotto comes down to a few principles: use a high-starch rice like Arborio or Carnaroli, toast it briefly in butter or oil before adding liquid, and add warm stock one ladle at a time — never dump it all in at once. Stir frequently so the starch releases slowly, creating that creamy texture without cream. Finish off the heat with cold butter and Parmigiano (the *mantecatura* step) for silkiness. Total cook time is usually 18–20 minutes once the stock starts going in.

### 2 — Tool call triggered (`lookup_recipe`)

> **User:** Can you give me the exact recipe for chocolate chip cookies?
>
> **Assistant:** *(calls `lookup_recipe` with `recipe_name: "chocolate chip cookies"`)* Here's the classic Toll House recipe:
>
> **Ingredients:** 2¼ cups flour, 1 tsp baking soda, 1 tsp salt, 1 cup softened butter, ¾ cup granulated sugar, ¾ cup brown sugar, 2 eggs, 2 tsp vanilla, 2 cups chocolate chips.
>
> **Instructions:** Preheat to 375 °F. Whisk together flour, baking soda, and salt. Beat butter and sugars until creamy; add eggs and vanilla. Blend in flour mixture; stir in chips. Drop rounded tablespoons on ungreased sheets and bake 9–11 minutes until golden. Makes ~48 cookies.

*(The tool_use → NestJS handler → tool_result cycle completes before the first token is streamed to the client.)*

### 3 — Off-topic refusal enforced by system prompt

> **User:** What do you think about the latest election results?
>
> **Assistant:** I'm sorry, but I can only help with cooking recipes, programming questions, and company information. Please ask me something related to these topics.

*(Off-topic refusals are enforced via the system prompt; the `finish_reason` is also inspected server-side so the app does not depend solely on model compliance.)*

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
data: {"token":"..."}    ← one per chunk
data: {"token":"..."}
data: {"done":true,"turnIndex":N}   ← stream close
data: {"error":"LLM unavailable"}   ← on mid-stream LLM failure
```

Tool calls are fully resolved (tool_use → handler → tool_result → final response) **before** the first token is streamed. The completed reply is stored in session history only after `done`.

### Frontend (Next.js 14+ App Router · `fe/`)

```
app/page.tsx               ← Server Component: reads cookie, fetches history, passes initialMessages
app/api/session/route.ts   ← Route Handler: creates NestJS session, sets HTTP-only cookie
app/api/chat/route.ts      ← BFF Route Handler: proxies NestJS SSE stream
components/ChatBox.tsx     ← 'use client': streaming UI, useOptimistic, SSE reader
```

**Session bootstrap (no client-side effect):**
1. `page.tsx` reads `sessionId` cookie with `cookies()` from `next/headers`
2. If missing → redirects to `GET /api/session` which creates the session, sets the cookie, and redirects back to `/`
3. `page.tsx` calls NestJS `/history` server-side and passes `initialMessages` as a prop

**`useOptimistic` flow:**
- `addOptimistic(userMessage)` is called inside `startTransition` → user bubble appears immediately
- On success: `setMessages([...prev, userMessage, botBubble])` commits both to real state (supersedes optimistic)
- On failure before commit: transition settles without `setMessages` → **automatic rollback** — the user bubble disappears

### BFF Proxy design decision

> **Why proxy NestJS through a Next.js Route Handler instead of calling NestJS directly from the browser?**

The browser's network tab would expose the NestJS origin URL and the LLM API key if they were used client-side. The BFF Route Handler (`app/api/chat/route.ts`) solves this by:

1. Reading the `sessionId` from the **HTTP-only cookie** (inaccessible to JavaScript)
2. Forwarding the request to NestJS using the server-only `API_URL` env var
3. **Piping the `ReadableStream` directly** (`new Response(response.body, {...})`) with zero buffering — tokens reach the browser with minimal latency
4. Translating 404/410 from NestJS into `{ sessionExpired: true }` JSON so the client can clear the cookie and reload cleanly

The NestJS URL and LLM key never appear in the browser's network tab.

---

## Testing

```bash
# Backend (Jest + NestJS testing utilities)
cd be && pnpm test

# Frontend (Jest + @testing-library/react)
cd fe && pnpm test
```

### Backend test surface

| Suite | Coverage |
|---|---|
| `SessionService` | Create, retrieve turns, expire after 30 min (mocked `Date.now`), delete |
| `LlmService` | History passed correctly, token stream forwarded, tool-call loop executed |
| `ChatController` | 201 on session create, 404 on unknown id, 410 on idle-expired id |
| `SessionController` | All CRUD paths |

### Frontend test surface

| Suite | Coverage |
|---|---|
| `ChatBox` | Renders `initialMessages`, optimistic bubble appears before fetch resolves, streaming token accumulation, rollback on error, session-expired banner, Send disabled in-flight |
| `/api/chat` Route Handler | Proxies SSE stream correctly, returns `sessionExpired` on 404/410 from NestJS, 400 on empty message, 401 on missing cookie |

---

## API reference

### NestJS endpoints

| Method | Path | Success | Errors |
|---|---|---|---|
| `POST` | `/chat/session` | 201 `{ sessionId }` | — |
| `POST` | `/chat/:id/message` | 200 SSE stream | 400 empty, 404 unknown, 410 expired |
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
- **Auto-scroll** — `useEffect` + `ref` scrolls to the latest message
- **Disable Send in-flight** — button disabled while `isPending` (React transition)
- **Enter to submit** — `onKeyDown` handler on the input
- **Relative timestamps** — `Intl.RelativeTimeFormat` ("2 minutes ago")
- **Streaming cursor** — blinking `|` on the live bot bubble; removed on `done`
- **Docker Compose** — `docker compose up` starts both services; frontend waits for backend health-check
