import { NotFoundException, GoneException } from '@nestjs/common';
import type Redis from 'ioredis';
import { SessionService } from './session.service';
import { MockRedis } from '../test/mock-redis';

class TestableSessionService extends SessionService {
  private mockTime: Date = new Date();

  setMockTime(time: Date): void {
    this.mockTime = time;
  }

  protected now(): Date {
    return this.mockTime;
  }
}

describe('SessionService', () => {
  let service: TestableSessionService;
  let mockRedis: MockRedis;

  beforeEach(() => {
    mockRedis = new MockRedis();
    service = new TestableSessionService(mockRedis as unknown as Redis);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createSession', () => {
    it('should create a new session and return sessionId', async () => {
      const sessionId = await service.createSession();
      expect(sessionId).toBeDefined();
      expect(typeof sessionId).toBe('string');
      expect(sessionId.length).toBeGreaterThan(0);
    });

    it('should create unique session IDs', async () => {
      const id1 = await service.createSession();
      const id2 = await service.createSession();
      expect(id1).not.toBe(id2);
    });

    it('should initialize session with empty turns', async () => {
      const sessionId = await service.createSession();
      const session = await service.getSession(sessionId);
      expect(session.turns).toEqual([]);
    });
  });

  describe('getSession', () => {
    it('should retrieve an existing session', async () => {
      const sessionId = await service.createSession();
      const session = await service.getSession(sessionId);
      expect(session.id).toBe(sessionId);
    });

    it('should throw NotFoundException for unknown sessionId', async () => {
      await expect(service.getSession('unknown-id')).rejects.toThrow(NotFoundException);
    });

    it('should update lastAccessedAt when session is retrieved', async () => {
      const start = new Date('2026-05-22T10:00:00Z');
      service.setMockTime(start);
      const sessionId = await service.createSession();

      const later = new Date('2026-05-22T10:05:00Z');
      service.setMockTime(later);
      const session = await service.getSession(sessionId);

      expect(new Date(session.lastAccessedAt).getTime()).toBe(later.getTime());
    });
  });

  describe('session expiry', () => {
    it('should expire session after 30 minutes of inactivity', async () => {
      const start = new Date('2026-05-22T10:00:00Z');
      service.setMockTime(start);
      const sessionId = await service.createSession();

      service.setMockTime(new Date('2026-05-22T10:31:00Z'));
      await expect(service.getSession(sessionId)).rejects.toThrow(GoneException);
    });

    it('should not expire session within 30 minutes', async () => {
      const start = new Date('2026-05-22T10:00:00Z');
      service.setMockTime(start);
      const sessionId = await service.createSession();

      service.setMockTime(new Date('2026-05-22T10:29:00Z'));
      await expect(service.getSession(sessionId)).resolves.toBeDefined();
    });

    it('should delete the Redis key when session expires', async () => {
      const start = new Date('2026-05-22T10:00:00Z');
      service.setMockTime(start);
      const sessionId = await service.createSession();

      service.setMockTime(new Date('2026-05-22T10:31:00Z'));
      try { await service.getSession(sessionId); } catch { /* expected */ }

      const sessions = await service.getAllSessions();
      expect(sessions.has(sessionId)).toBe(false);
    });

    it('should throw GoneException (not NotFoundException) for an expired-then-deleted session', async () => {
      const start = new Date('2026-05-22T10:00:00Z');
      service.setMockTime(start);
      const sessionId = await service.createSession();

      service.setMockTime(new Date('2026-05-22T10:31:00Z'));
      try { await service.getSession(sessionId); } catch { /* expected */ }

      // Second access after expiry → 410, not 404
      await expect(service.getSession(sessionId)).rejects.toThrow(GoneException);
    });
  });

  describe('addTurn', () => {
    it('should add a turn to session history', async () => {
      const sessionId = await service.createSession();
      const turnIndex = await service.addTurn(sessionId, 'Hello', 'Hi there');

      expect(turnIndex).toBe(0);
      const session = await service.getSession(sessionId);
      expect(session.turns).toHaveLength(1);
      expect(session.turns[0]).toMatchObject({
        message: 'Hello',
        reply: 'Hi there',
        turnIndex: 0,
      });
    });

    it('should increment turnIndex for multiple turns', async () => {
      const sessionId = await service.createSession();
      await service.addTurn(sessionId, 'First', 'Response 1');
      await service.addTurn(sessionId, 'Second', 'Response 2');
      const turnIndex = await service.addTurn(sessionId, 'Third', 'Response 3');

      expect(turnIndex).toBe(2);
      const session = await service.getSession(sessionId);
      expect(session.turns).toHaveLength(3);
    });

    it('should throw NotFoundException for unknown sessionId', async () => {
      await expect(service.addTurn('unknown-id', 'msg', 'reply')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getHistory', () => {
    it('should return all turns for a session', async () => {
      const sessionId = await service.createSession();
      await service.addTurn(sessionId, 'Message 1', 'Reply 1');
      await service.addTurn(sessionId, 'Message 2', 'Reply 2');

      const history = await service.getHistory(sessionId);
      expect(history).toHaveLength(2);
      expect(history[0].message).toBe('Message 1');
      expect(history[1].message).toBe('Message 2');
    });

    it('should return empty array for new session', async () => {
      const sessionId = await service.createSession();
      const history = await service.getHistory(sessionId);
      expect(history).toEqual([]);
    });

    it('should throw NotFoundException for unknown sessionId', async () => {
      await expect(service.getHistory('unknown-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteSession', () => {
    it('should delete an existing session', async () => {
      const sessionId = await service.createSession();
      await service.deleteSession(sessionId);
      await expect(service.getSession(sessionId)).rejects.toThrow(GoneException);
    });

    it('should throw NotFoundException when deleting unknown sessionId', async () => {
      await expect(service.deleteSession('unknown-id')).rejects.toThrow(NotFoundException);
    });
  });
});
