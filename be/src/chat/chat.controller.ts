import { Body, Controller, Post, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ChatService, MessageResponse } from './chat.service';
import { SessionService } from '../session/session.service';
import { SendMessageDto } from './dto/send-message.dto';

@Controller('chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly sessionService: SessionService,
  ) {}

  // No HTTP decorator — used only in unit tests to exercise error paths.
  async sendMessage(sessionId: string, dto: SendMessageDto): Promise<MessageResponse> {
    return this.chatService.sendMessage(sessionId, dto);
  }

  @Post(':sessionId/message')
  async streamMessage(
    @Param('sessionId') sessionId: string,
    @Body() dto: SendMessageDto,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');

    try {
      for await (const token of this.chatService.sendMessageStream(sessionId, dto)) {
        res.write(`data: ${JSON.stringify({ token })}\n\n`);
      }

      const session = await this.sessionService.getSession(sessionId);
      const turnIndex = session.turns.length - 1;
      res.write(`data: ${JSON.stringify({ done: true, turnIndex })}\n\n`);
      res.end();
    } catch (error) {
      console.error('Streaming error:', error);
      res.write(`data: ${JSON.stringify({ error: 'LLM unavailable' })}\n\n`);
      res.end();
    }
  }
}
