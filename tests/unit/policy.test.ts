import { describe, expect, it } from 'vitest';
import { allowedWhileLocked, conversationIdFromUrl } from '../../src/shared/policy';
const locked = { phase: 'LOCKED' as const, revision: 2, guestSessionId: 'session' };
describe('guest navigation policy', () => {
  it('recognizes only canonical conversation URLs', () => expect(conversationIdFromUrl('https://chatgpt.com/c/abc-123')).toBe('abc-123'));
  it('allows a fresh route and verified session conversation', () => { expect(allowedWhileLocked('https://chatgpt.com/', locked, new Set())).toBe(true); expect(allowedWhileLocked('https://chatgpt.com/c/guest', locked, new Set(['guest']))).toBe(true); });
  it('blocks owner and unknown conversation routes', () => expect(allowedWhileLocked('https://chatgpt.com/c/owner', locked, new Set(['guest']))).toBe(false));
});
