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

  if (!sessionId) {
    redirect('/api/session');
  }

  const historyData = await getHistory(sessionId);
  const initialMessages = turnsToMessages(historyData.turns);

  return <ChatBox initialMessages={initialMessages} />;
}
