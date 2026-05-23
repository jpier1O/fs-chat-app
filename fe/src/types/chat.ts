export interface Turn {
  message: string;
  reply: string;
  turnIndex: number;
  timestamp: string;
}

export interface UserMessage {
  id: string;
  type: 'user';
  content: string;
  timestamp: Date;
}

export interface BotMessage {
  id: string;
  type: 'bot';
  content: string;
  timestamp: Date;
  turnIndex?: number;
  isStreaming?: boolean;
}

export type Message = UserMessage | BotMessage;

export interface SendMessageResponse {
  reply: string;
  turnIndex: number;
}

export interface HistoryResponse {
  turns: Turn[];
}
