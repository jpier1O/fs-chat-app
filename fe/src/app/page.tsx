import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import ChatBox from '@/components/ChatBox';
import { getHistory } from '@/lib/chat-api';
import type { Message, Turn } from '@/types/chat';

function turnsToMessages(turns: Turn[]): Message[] {
  const messages: Message[] = [];

  for (const turn of turns) {
    messages.push({
      id: `user-${turn.turnIndex}`,
      type: 'user',
      content: turn.message,
      timestamp: new Date(turn.timestamp),
    });
    messages.push({
      id: `bot-${turn.turnIndex}`,
      type: 'bot',
      content: turn.reply,
      timestamp: new Date(turn.timestamp),
      turnIndex: turn.turnIndex,
    });
  }

  return messages;
}

export default async function Home() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get('sessionId')?.value;

  // No session cookie → Route Handler creates one and sets cookie, then redirects here
  if (!sessionId) {
    redirect('/api/session');
  }

  // Fetch initial history server-side; empty array on any session error
  const historyData = await getHistory(sessionId);
  const initialMessages = turnsToMessages(historyData.turns);

  return <ChatBox sessionId={sessionId} initialMessages={initialMessages} />;
}
