import { randomUUID } from 'crypto';
import { Injectable, NotFoundException, GoneException, Inject } from '@nestjs/common';
import type Redis from 'ioredis';

export interface Turn {
  message: string;
  reply: string;
  turnIndex: number;
  timestamp: string; // ISO-8601; serialised through Redis as JSON
}

export interface Session {
  id: string;
  turns: Turn[];
  createdAt: string;
  lastAccessedAt: string;
}

@Injectable()
export class SessionService {
  private readonly SESSION_TIMEOUT_MS = 30 * 60 * 1000;

  constructor(@Inject('REDIS') protected readonly redis: Redis) {}

  protected now(): Date {
    return new Date();
  }

  async createSession(): Promise<string> {
    const sessionId = randomUUID();
    const now = this.now().toISOString();
    const session: Session = {
      id: sessionId,
      turns: [],
      createdAt: now,
      lastAccessedAt: now,
    };
    await this.redis.set(`session:${sessionId}`, JSON.stringify(session));
    // Track every created ID so we can distinguish 404 vs 410 later.
    await this.redis.sadd('session_ids', sessionId);
    return sessionId;
  }

  async getSession(sessionId: string): Promise<Session> {
    const data = await this.redis.get(`session:${sessionId}`);

    if (!data) {
      const known = await this.redis.sismember('session_ids', sessionId);
      if (known) {
        throw new GoneException(`Session ${sessionId} has expired due to inactivity`);
      }
      throw new NotFoundException(`Session ${sessionId} not found`);
    }

    const session = JSON.parse(data) as Session;
    const now = this.now();
    const elapsed = now.getTime() - new Date(session.lastAccessedAt).getTime();

    if (elapsed > this.SESSION_TIMEOUT_MS) {
      await this.redis.del(`session:${sessionId}`);
      throw new GoneException(`Session ${sessionId} has expired due to inactivity`);
    }

    session.lastAccessedAt = now.toISOString();
    await this.redis.set(`session:${sessionId}`, JSON.stringify(session));
    return session;
  }

  async addTurn(sessionId: string, message: string, reply: string): Promise<number> {
    const session = await this.getSession(sessionId);
    const turnIndex = session.turns.length;
    session.turns.push({
      message,
      reply,
      turnIndex,
      timestamp: this.now().toISOString(),
    });
    await this.redis.set(`session:${sessionId}`, JSON.stringify(session));
    return turnIndex;
  }

  async getHistory(sessionId: string): Promise<Turn[]> {
    const session = await this.getSession(sessionId);
    return session.turns;
  }

  async deleteSession(sessionId: string): Promise<void> {
    const exists = await this.redis.exists(`session:${sessionId}`);
    if (!exists) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }
    await this.redis.del(`session:${sessionId}`);
  }

  /** For testing only — avoid KEYS in production. */
  async getAllSessions(): Promise<Map<string, Session>> {
    const keys = await this.redis.keys('session:*');
    const result = new Map<string, Session>();
    for (const key of keys) {
      const data = await this.redis.get(key);
      if (data) {
        const s = JSON.parse(data) as Session;
        result.set(s.id, s);
      }
    }
    return result;
  }
}
