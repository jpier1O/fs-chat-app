import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 60 * 30, // 30 minutes
  path: '/',
};

// GET — called when the Server Component redirects here because there is no cookie.
// Creates a session in NestJS, sets the HTTP-only cookie, and redirects to /.
export async function GET(request: NextRequest) {
  try {
    const response = await fetch(`${API_URL}/chat/session`, { method: 'POST' });

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
    }

    const data = (await response.json()) as { sessionId: string };
    const { sessionId } = data;

    const redirectResponse = NextResponse.redirect(new URL('/', request.url));
    redirectResponse.cookies.set('sessionId', sessionId, COOKIE_OPTIONS);
    return redirectResponse;
  } catch {
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
  }
}

// POST — called directly by the client (e.g. after a session expires).
export async function POST() {
  try {
    const response = await fetch(`${API_URL}/chat/session`, { method: 'POST' });

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
    }

    const data = (await response.json()) as { sessionId: string };
    const { sessionId } = data;

    const res = NextResponse.json({ sessionId });
    res.cookies.set('sessionId', sessionId, COOKIE_OPTIONS);
    return res;
  } catch {
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
  }
}

// DELETE — clears the session cookie.
export async function DELETE() {
  try {
    const res = NextResponse.json({ success: true });
    res.cookies.delete('sessionId');
    return res;
  } catch {
    return NextResponse.json({ error: 'Failed to delete session' }, { status: 500 });
  }
}
