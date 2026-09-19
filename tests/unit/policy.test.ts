import { describe, expect, it } from 'vitest';
import { allowedWhileLocked, conversationIdFromUrl } from '../../src/shared/policy';
const locked = { phase: 'LOCKED' as const, revision: 2, guestSessionId: 'session' };
describe('guest navigation policy', () => {
  it('recognizes only canonical conversation URLs', () => expect(conversationIdFromUrl('https://chatgpt.com/c/abc-123')).toBe('abc-123'));
  it('allows a fresh route and verified session conversation', () => { expect(allowedWhileLocked('https://chatgpt.com/', locked, new Set())).toBe(true); expect(allowedWhileLocked('https://chatgpt.com/c/guest', locked, new Set(['guest']))).toBe(true); });
  it('blocks owner and unknown conversation routes', () => expect(allowedWhileLocked('https://chatgpt.com/c/owner', locked, new Set(['guest']))).toBe(false));
  it.each(['/settings', '/settings/account', '/#settings', '/#settings/General', '/#/settings', '/#%73ettings', '/?settings=general', '/?modal=settings', '/c/guest#settings'])('blocks settings route %s while locked', route => {
    expect(allowedWhileLocked(`https://chatgpt.com${route}`, locked, new Set(['guest']))).toBe(false);
  });
  it('allows settings again after unlocking', () => {
    expect(allowedWhileLocked('https://chatgpt.com/#settings', { phase: 'UNLOCKED', revision: 3 }, new Set())).toBe(true);
  });
  it('uses Claude chat routes without accepting unknown chats', () => {
    expect(conversationIdFromUrl('https://claude.ai/chat/claude-guest')).toBe('claude-guest');
    expect(allowedWhileLocked('https://claude.ai/new', locked, new Set())).toBe(true);
    expect(allowedWhileLocked('https://claude.ai/chat/claude-guest', locked, new Set(['claude-guest']))).toBe(true);
    expect(allowedWhileLocked('https://claude.ai/chat/owner-chat', locked, new Set(['claude-guest']))).toBe(false);
  });
});
