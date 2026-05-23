import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChatBox from '@/components/ChatBox';
import type { Message } from '@/types/chat';

// ── jsdom shims ───────────────────────────────────────────────────────────────

// jsdom does not expose TextEncoder/TextDecoder/ReadableStream globally
const { TextEncoder, TextDecoder } = require('util') as typeof import('util');
const { ReadableStream } = require('stream/web') as typeof import('stream/web');
(global as unknown as Record<string, unknown>).TextEncoder = TextEncoder;
(global as unknown as Record<string, unknown>).TextDecoder = TextDecoder;
(global as unknown as Record<string, unknown>).ReadableStream = ReadableStream;

beforeAll(() => {
  // jsdom does not implement scrollIntoView
  window.HTMLElement.prototype.scrollIntoView = jest.fn();
});

// crypto.randomUUID is not in jsdom
Object.defineProperty(global, 'crypto', {
  value: { randomUUID: () => 'uuid-' + Math.random().toString(36).slice(2) },
});

// ── helpers ───────────────────────────────────────────────────────────────────

function makeUserMsg(id: string, content: string): Message {
  return { id, type: 'user', content, timestamp: new Date() };
}

function makeBotMsg(id: string, content: string, turnIndex = 0): Message {
  return { id, type: 'bot', content, timestamp: new Date(), turnIndex };
}

function buildSseStream(events: string[]): ReadableStream<Uint8Array<ArrayBufferLike>> {
  const encoder = new TextEncoder();
  // stream/web ReadableStream is structurally identical at runtime but its .d.ts
  // diverges from the lib.dom type; cast to silence the cross-module mismatch.
  return new ReadableStream({
    start(controller) {
      for (const ev of events) {
        controller.enqueue(encoder.encode(`data: ${ev}\n\n`));
      }
      controller.close();
    },
  }) as unknown as ReadableStream<Uint8Array<ArrayBufferLike>>;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('ChatBox', () => {
  const sessionId = 'test-session';

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  it('renders initialMessages on mount', () => {
    const messages: Message[] = [
      makeUserMsg('u0', 'Hello'),
      makeBotMsg('b0', 'Hi there!', 0),
    ];

    render(<ChatBox sessionId={sessionId} initialMessages={messages} />);

    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hi there!')).toBeInTheDocument();
  });

  it('shows optimistic user bubble before the server responds', async () => {
    const user = userEvent.setup();
    // Fetch hangs — simulates an in-flight request
    (global.fetch as jest.Mock).mockReturnValue(new Promise(() => {}));

    render(<ChatBox sessionId={sessionId} initialMessages={[]} />);

    await user.type(screen.getByPlaceholderText('Type your message...'), 'Test optimistic');
    await user.click(screen.getByRole('button', { name: /send/i }));

    // Optimistic bubble appears immediately, before the server responds
    expect(screen.getByText('Test optimistic')).toBeInTheDocument();
  });

  it('appends bot reply by accumulating SSE token chunks', async () => {
    const user = userEvent.setup();

    const stream = buildSseStream([
      JSON.stringify({ token: 'Hello ' }),
      JSON.stringify({ token: 'world!' }),
      JSON.stringify({ done: true, turnIndex: 0 }),
    ]);

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      body: stream,
      json: jest.fn(),
    });

    render(<ChatBox sessionId={sessionId} initialMessages={[]} />);

    await user.type(screen.getByPlaceholderText('Type your message...'), 'Hi');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByText('Hello world!')).toBeInTheDocument();
    });
  });

  it('shows an error banner on network failure', async () => {
    const user = userEvent.setup();
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

    render(<ChatBox sessionId={sessionId} initialMessages={[]} />);

    await user.type(screen.getByPlaceholderText('Type your message...'), 'Failing');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByText(/Network error/i)).toBeInTheDocument();
    });
  });

  it('shows a session-expired banner when BFF returns sessionExpired', async () => {
    const user = userEvent.setup();

    (global.fetch as jest.Mock)
      // send message → sessionExpired
      .mockResolvedValueOnce({
        ok: false,
        status: 410,
        json: jest.fn().mockResolvedValue({ sessionExpired: true }),
        body: null,
      })
      // DELETE /api/session (called by clearSession)
      .mockResolvedValueOnce({ ok: true, json: jest.fn() });

    render(<ChatBox sessionId={sessionId} initialMessages={[]} />);

    await user.type(screen.getByPlaceholderText('Type your message...'), 'hello');
    await user.click(screen.getByRole('button', { name: /send/i }));

    // Banner is set synchronously; window.location.reload fires 2 s later (not reached in test)
    await waitFor(() => {
      expect(screen.getByText(/session expired/i)).toBeInTheDocument();
    });
  });

  it('disables the Send button while a request is in-flight', async () => {
    const user = userEvent.setup();
    // Fetch never resolves
    (global.fetch as jest.Mock).mockReturnValue(new Promise(() => {}));

    render(<ChatBox sessionId={sessionId} initialMessages={[]} />);

    await user.type(screen.getByPlaceholderText('Type your message...'), 'test');
    const btn = screen.getByRole('button', { name: /send/i });
    await user.click(btn);

    expect(btn).toBeDisabled();
  });
});
