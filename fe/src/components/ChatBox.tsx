'use client';

import {
  useState,
  useOptimistic,
  useRef,
  useEffect,
  useTransition,
  FormEvent,
} from 'react';
import type { Message } from '@/types/chat';
import { clearSession } from '@/lib/chat-api';

interface ChatBoxProps {
  sessionId: string;
  initialMessages: Message[];
}

export default function ChatBox({ sessionId: _sessionId, initialMessages }: ChatBoxProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [optimisticMessages, addOptimistic] = useOptimistic(
    messages,
    (state, newMessage: Message) => [...state, newMessage],
  );
  const [input, setInput] = useState('');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [optimisticMessages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSessionExpired = async () => {
    setSessionExpired(true);
    await clearSession();
    setTimeout(() => {
      window.location.reload();
    }, 2000);
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isPending) return;

    setError(null);
    setInput('');

    const userMessage: Message = {
      id: crypto.randomUUID(),
      type: 'user',
      content: text,
      timestamp: new Date(),
    };

    startTransition(async () => {
      // Show the user bubble immediately
      addOptimistic(userMessage);

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text }),
        });

        if (response.status === 401 || response.status === 404 || response.status === 410) {
          const data = (await response.json()) as { sessionExpired?: boolean };
          if (data.sessionExpired) {
            await handleSessionExpired();
            return;
          }
        }

        if (!response.ok) {
          const errorData = (await response.json()) as { error?: string };
          throw new Error(errorData.error ?? 'Failed to send message');
        }

        const botMessageId = crypto.randomUUID();
        let botContent = '';
        let turnIndex = 0;

        // user message with empty bot bubble together to real state.
        setMessages((prev) => {
          const hasUser = prev.some((m) => m.id === userMessage.id);
          return [
            ...prev,
            ...(hasUser ? [] : [userMessage]),
            {
              id: botMessageId,
              type: 'bot' as const,
              content: '',
              timestamp: new Date(),
              isStreaming: true,
            } as Message,
          ];
        });

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        if (!reader) throw new Error('No response body');

        let lineBuffer = '';
        outer: while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          lineBuffer += decoder.decode(value, { stream: true });
          const lines = lineBuffer.split('\n');
          lineBuffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(line.slice(6)) as {
                token?: string;
                done?: boolean;
                turnIndex?: number;
                error?: string;
              };

              if (data.error) throw new Error(data.error);

              if (data.token) {
                botContent += data.token;
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === botMessageId ? { ...msg, content: botContent } : msg,
                  ),
                );
              }

              if (data.done) {
                turnIndex = data.turnIndex ?? turnIndex;
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === botMessageId
                      ? { ...msg, content: botContent, turnIndex, isStreaming: false }
                      : msg,
                  ),
                );
                break outer;
              }
            } catch {
              // ignore parse errors on individual SSE lines
            }
          }
        }

        // Ensure isStreaming is cleared even if done event was missed
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === botMessageId && (msg as Message & { isStreaming?: boolean }).isStreaming
              ? { ...msg, isStreaming: false }
              : msg,
          ),
        );
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        if (errorMessage === 'SESSION_NOT_FOUND' || errorMessage === 'SESSION_EXPIRED') {
          await handleSessionExpired();
          return;
        }
        setError(errorMessage);
        // Remove any partial streaming bot bubble.
        setMessages((prev) =>
          prev.filter((msg) => !((msg as Message & { isStreaming?: boolean }).isStreaming)),
        );
      }
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  };

  const formatTimestamp = (timestamp: Date) => {
    const now = new Date();
    const diff = now.getTime() - new Date(timestamp).getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

    if (seconds < 60) return rtf.format(-seconds, 'second');
    if (minutes < 60) return rtf.format(-minutes, 'minute');
    if (hours < 24) return rtf.format(-hours, 'hour');
    return new Date(timestamp).toLocaleString();
  };

  if (sessionExpired) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-50">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 max-w-md">
          <h2 className="text-xl font-semibold text-yellow-800 mb-2">Session Expired</h2>
          <p className="text-yellow-700">
            Your session has expired due to inactivity. Refreshing...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <h1 className="text-xl font-semibold text-gray-800">Chat Assistant</h1>
        <p className="text-sm text-gray-500">
          Turn {optimisticMessages.filter((m) => m.type === 'user').length}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {optimisticMessages.length === 0 && (
          <div className="text-center text-gray-500 mt-8">
            <p>Start a conversation by typing a message below.</p>
          </div>
        )}

        {optimisticMessages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-xs md:max-w-md lg:max-w-lg px-4 py-2 rounded-lg ${
                message.type === 'user'
                  ? 'bg-blue-500 text-white'
                  : 'bg-white text-gray-800 border border-gray-200'
              }`}
            >
              <p className="whitespace-pre-wrap wrap-break-word">
                {message.content}
                {message.type === 'bot' && (message as { isStreaming?: boolean }).isStreaming && (
                  <span className="animate-pulse">|</span>
                )}
              </p>
              <p
                className={`text-xs mt-1 ${
                  message.type === 'user' ? 'text-blue-100' : 'text-gray-400'
                }`}
              >
                {formatTimestamp(message.timestamp)}
              </p>
            </div>
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {error && (
        <div className="mx-6 mb-2 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="bg-white border-t border-gray-200 px-6 py-4">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your message..."
            disabled={isPending}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            disabled={isPending || input.trim().length === 0}
            className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {isPending ? 'Sending...' : 'Send'}
          </button>
        </form>
        <p className="text-xs text-gray-500 mt-2">Press Enter to send</p>
      </div>
    </div>
  );
}
