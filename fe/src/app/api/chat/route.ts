import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

const API_URL =
  process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

// ── Rate-limit constants ──────────────────────────────────────────────────────
const RL_MAX = 20;
const RL_WINDOW_MS = 60 * 60 * 1000; // 1 hour

interface RateLimitData {
  count: number;
  windowStart: number;
}

function parseRateLimitCookie(raw: string | undefined): RateLimitData {
  if (!raw) return { count: 0, windowStart: Date.now() };
  try {
    return JSON.parse(raw) as RateLimitData;
  } catch {
    return { count: 0, windowStart: Date.now() };
  }
}

// ── Route Handler ─────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get('sessionId')?.value;

    if (!sessionId) {
      return NextResponse.json({ sessionExpired: true }, { status: 401 });
    }

    // ── Sliding-window rate limit (per session, cookie-backed) ────────────
    const rawRl = cookieStore.get('bff_rate')?.value;
    const rl = parseRateLimitCookie(rawRl);
    const now = Date.now();

    if (now - rl.windowStart > RL_WINDOW_MS) {
      rl.count = 0;
      rl.windowStart = now;
    }

    rl.count += 1;

    if (rl.count > RL_MAX) {
      const retryAfter = Math.ceil((rl.windowStart + RL_WINDOW_MS - now) / 1000);
      return new NextResponse(JSON.stringify({ error: 'Rate limit exceeded' }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(retryAfter),
          'Set-Cookie': buildRlCookie(rl),
        },
      });
    }

    // ── Validate body ─────────────────────────────────────────────────────
    const body = await request.json();
    const { message } = body as { message?: string };

    if (!message || !message.trim()) {
      return NextResponse.json({ error: 'Message cannot be empty.' }, { status: 400 });
    }

    // ── Proxy to NestJS SSE endpoint ──────────────────────────────────────
    const upstream = await fetch(`${API_URL}/chat/${sessionId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message.trim() }),
      cache: 'no-store',
    });

    if (upstream.status === 404 || upstream.status === 410) {
      return NextResponse.json(
        { sessionExpired: true },
        { status: upstream.status },
      );
    }

    if (!upstream.ok) {
      return NextResponse.json({ error: 'Failed to send message' }, { status: upstream.status });
    }

    // ── Stream SSE body through, setting the updated rate-limit cookie ────
    return new Response(upstream.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Set-Cookie': buildRlCookie(rl),
      },
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function buildRlCookie(rl: RateLimitData): string {
  const maxAge = Math.ceil((rl.windowStart + RL_WINDOW_MS - Date.now()) / 1000);
  return `bff_rate=${JSON.stringify(rl)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`;
}
