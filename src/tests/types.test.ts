import { describe, it, expect } from 'vitest';
import { type TeammateState, type TeammateStatus, type MemfsStartup } from '../types.js';

describe('types', () => {
  describe('TeammateState', () => {
    it('should allow creating a valid state object', () => {
      const state: TeammateState = {
        name: 'researcher',
        role: 'Research assistant',
        agentId: 'agent-123',
        status: 'idle',
        lastUpdated: '2026-03-06T10:00:00Z',
        createdAt: '2026-03-06T09:00:00Z',
      };

      expect(state.name).toBe('researcher');
      expect(state.role).toBe('Research assistant');
      expect(state.status).toBe('idle');
    });

    it('should allow optional fields', () => {
      const state: TeammateState = {
        name: 'coder',
        role: 'Software developer',
        agentId: 'agent-456',
        model: 'claude-sonnet-4-20250514',
        conversationId: 'conv-789',
        memfsEnabled: true,
        memfsStartup: 'background',
        status: 'working',
        todo: 'Implementing feature',
        lastUpdated: '2026-03-06T10:00:00Z',
        createdAt: '2026-03-06T09:00:00Z',
      };

      expect(state.model).toBe('claude-sonnet-4-20250514');
      expect(state.conversationId).toBe('conv-789');
      expect(state.todo).toBe('Implementing feature');
      expect(state.memfsEnabled).toBe(true);
      expect(state.memfsStartup).toBe('background');
    });
  });

  describe('TeammateStatus', () => {
    it('should have valid status values', () => {
      const statuses: TeammateStatus[] = ['working', 'idle', 'done', 'error'];

      statuses.forEach((status) => {
        expect(['working', 'idle', 'done', 'error']).toContain(status);
      });
    });
  });

  describe('MemfsStartup', () => {
    it('should have valid startup modes', () => {
      const modes: MemfsStartup[] = ['blocking', 'background', 'skip'];

      modes.forEach((mode) => {
        expect(['blocking', 'background', 'skip']).toContain(mode);
      });
    });
  });
});
