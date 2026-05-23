import { Injectable } from '@nestjs/common';
import { SessionService } from '../session/session.service';
import { LlmService, LlmMessage } from '../llm/llm.service';
import { SendMessageDto } from './dto/send-message.dto';

export interface MessageResponse {
  reply: string;
  turnIndex: number;
}

@Injectable()
export class ChatService {
  constructor(
    private readonly sessionService: SessionService,
    private readonly llmService: LlmService,
  ) {}

  async sendMessage(sessionId: string, dto: SendMessageDto): Promise<MessageResponse> {
    const message = dto.message.trim();
    const reply = `Echo: ${message}`;
    const turnIndex = await this.sessionService.addTurn(sessionId, message, reply);
    return { reply, turnIndex };
  }

  async *sendMessageStream(
    sessionId: string,
    dto: SendMessageDto,
  ): AsyncGenerator<string, void, unknown> {
    const message = dto.message.trim();
    const session = await this.sessionService.getSession(sessionId);

    const history: LlmMessage[] = [];
    for (const turn of session.turns) {
      history.push({ role: 'user', content: turn.message });
      history.push({ role: 'model', content: turn.reply });
    }

    let fullReply = '';
    try {
      for await (const token of this.llmService.generateStream(history, message)) {
        fullReply += token;
        yield token;
      }
      await this.sessionService.addTurn(sessionId, message, fullReply);
    } catch (error) {
      console.error('Error generating LLM response:', error);
      throw error;
    }
  }
}
