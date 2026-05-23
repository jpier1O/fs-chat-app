/**
 * @jest-environment node
 *
 * Route Handlers use Web Request/Response APIs — those are built into Node 18+
 * but are not available in jsdom, so we switch to the node environment here.
 */
import '@testing-library/jest-dom';

// ── mock next/headers (cookies) ───────────────────────────────────────────────
const mockCookieGet = jest.fn();
jest.mock('next/headers', () => ({
  cookies: jest.fn(() =>
    Promise.resolve({
      get: mockCookieGet,
    }),
  ),
}));

// ── import handler after mocks are registered ─────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { POST } = require('@/app/api/chat/route') as {
  POST: (req: Request) => Promise<Response>;
};

// ── helpers ────────────────────────────────────────────────────────────────────

function buildSseStream(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const ev of events) {
        controller.enqueue(encoder.encode(`data: ${ev}\n\n`));
      }
      controller.close();
    },
  });
}

function makeRequest(body: object): Request {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ── tests ──────────────────────────────────────────────────────────────────────

describe('/api/chat Route Handler (BFF)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  it('returns 401 with sessionExpired when there is no session cookie', async () => {
    mockCookieGet.mockReturnValue(undefined);

    const req = makeRequest({ message: 'hello' });
    const res = await POST(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.sessionExpired).toBe(true);
  });

  it('proxies the NestJS SSE stream to the client with correct Content-Type', async () => {
    mockCookieGet.mockReturnValue({ value: 'test-session-id' });

    const stream = buildSseStream([
      JSON.stringify({ token: 'Hello' }),
      JSON.stringify({ done: true, turnIndex: 0 }),
    ]);

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      body: stream,
    });

    const req = makeRequest({ message: 'hello' });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(res.body).not.toBeNull();
  });

  it('returns sessionExpired when NestJS responds 404', async () => {
    mockCookieGet.mockReturnValue({ value: 'test-session-id' });

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 404,
      body: null,
      json: jest.fn().mockResolvedValue({}),
    });

    const req = makeRequest({ message: 'hello' });
    const res = await POST(req);

    const body = await res.json();
    expect(body.sessionExpired).toBe(true);
  });

  it('returns 410 with sessionExpired when NestJS responds 410 (session expired)', async () => {
    mockCookieGet.mockReturnValue({ value: 'test-session-id' });

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 410,
      body: null,
      json: jest.fn().mockResolvedValue({}),
    });

    const req = makeRequest({ message: 'hello' });
    const res = await POST(req);

    const body = await res.json();
    expect(body.sessionExpired).toBe(true);
    expect(res.status).toBe(410);
  });

  it('returns 400 when the message is empty or whitespace', async () => {
    mockCookieGet.mockReturnValue({ value: 'test-session-id' });

    const req = makeRequest({ message: '   ' });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Message cannot be empty.');
  });

  it('returns 429 when the sliding-window rate limit is exceeded', async () => {
    // Pre-fill the cookie with count=20 (at limit)
    mockCookieGet.mockImplementation((name: string) => {
      if (name === 'sessionId') return { value: 'test-session-id' };
      if (name === 'bff_rate') {
        return { value: JSON.stringify({ count: 20, windowStart: Date.now() }) };
      }
      return undefined;
    });

    const req = makeRequest({ message: 'hello' });
    const res = await POST(req);

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe('Rate limit exceeded');
    expect(res.headers.get('Retry-After')).toBeTruthy();
  });

  it('resets the rate-limit window when the previous window has expired', async () => {
    // Provide an expired window (started 2 hours ago)
    const expiredWindowStart = Date.now() - 2 * 60 * 60 * 1000;
    mockCookieGet.mockImplementation((name: string) => {
      if (name === 'sessionId') return { value: 'test-session-id' };
      if (name === 'bff_rate') {
        return { value: JSON.stringify({ count: 20, windowStart: expiredWindowStart }) };
      }
      return undefined;
    });

    const stream = buildSseStream([
      JSON.stringify({ token: 'Hi' }),
      JSON.stringify({ done: true, turnIndex: 0 }),
    ]);

    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200, body: stream });

    const req = makeRequest({ message: 'hello' });
    const res = await POST(req);

    // Window was expired → count reset to 1 → request allowed
    expect(res.status).toBe(200);
  });
});
