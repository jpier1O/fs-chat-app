import type { HistoryResponse } from '@/types/chat';

const getApiUrl = () => {
  if (typeof window === 'undefined') {
    return process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
  }
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
};

export async function getHistory(sessionId: string): Promise<HistoryResponse> {
  const API_URL = getApiUrl();

  try {
    const response = await fetch(`${API_URL}/chat/${sessionId}/history`, {
      cache: 'no-store',
    });

    if (!response.ok) {
      return { turns: [] };
    }

    return await response.json();
  } catch {
    return { turns: [] };
  }
}

export async function clearSession(): Promise<void> {
  await fetch('/api/session', {
    method: 'DELETE',
  });
}
