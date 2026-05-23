import type { SendMessageResponse, HistoryResponse } from '@/types/chat';

// Use server-side API_URL or client-side NEXT_PUBLIC_API_URL
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
      if (response.status === 404 || response.status === 410) {
        return { turns: [] };
      }
      throw new Error('Failed to fetch history');
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching history:', error);
    return { turns: [] };
  }
}

export async function sendMessage(
  sessionId: string,
  message: string
): Promise<SendMessageResponse> {
  const API_URL = getApiUrl();
  
  const response = await fetch(`${API_URL}/chat/${sessionId}/message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message }),
  });

  if (!response.ok) {
    const status = response.status;
    if (status === 400) {
      throw new Error('Message cannot be empty.');
    }
    if (status === 404) {
      throw new Error('SESSION_NOT_FOUND');
    }
    if (status === 410) {
      throw new Error('SESSION_EXPIRED');
    }
    throw new Error('Failed to send message');
  }

  return await response.json();
}

// Client-side function to create session
export async function createSession(): Promise<string> {
  const response = await fetch('/api/session', {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error('Failed to create session');
  }

  const data = await response.json();
  return data.sessionId;
}

// Client-side function to clear session cookie
export async function clearSession(): Promise<void> {
  await fetch('/api/session', {
    method: 'DELETE',
  });
}
