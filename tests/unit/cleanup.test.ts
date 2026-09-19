import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuestConversation, LockState } from '../../src/shared/types';
import { deleteChats } from '../../src/background/cleanup';

let state: LockState;
let chats: GuestConversation[];
let send: ReturnType<typeof vi.fn>;
let remove: ReturnType<typeof vi.fn>;
const chat = (id: string, provider: 'chatgpt' | 'claude' = 'claude'): GuestConversation => ({ id, provider, title: id, sessionId: 'session', tabId: 1, createdAt: 0, evidence: 'submission-route', confidence: 'verified', cleanupStatus: 'unreviewed' });
beforeEach(() => {
  vi.useFakeTimers();
  state = { phase: 'UNLOCKED', revision: 3, lastGuestSessionId: 'session' }; chats = [chat('one'), chat('two')];
  let nextTab = 10;
  send = vi.fn(async (_id, message) => message.type === 'CLEANUP_READY' ? { ok: true } : { ok: true });
  remove = vi.fn(async () => {});
  vi.stubGlobal('chrome', {
    runtime: { onMessage: { addListener: vi.fn() } },
    webNavigation: { onHistoryStateUpdated: { addListener: vi.fn() } },
    storage: { local: {
      get: vi.fn(async (key: string) => ({ [key]: structuredClone(key === 'lockState' ? state : chats) })),
      set: vi.fn(async (value) => { if (value.guestChats) chats = structuredClone(value.guestChats); }),
    } },
    tabs: { create: vi.fn(async () => ({ id: nextTab++ })), get: vi.fn(async () => ({ status: 'complete' })), sendMessage: send, remove },
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('cleanup controller', () => {
  it('waits for the imported script to be ready and sends the destructive command only once', async () => {
    let attempts = 0;
    send.mockImplementation(async (_id, message) => {
      if (message.type === 'CLEANUP_READY' && attempts++ < 2) throw new Error('No receiver');
      return { ok: true };
    });
    const result = deleteChats(['one']); await vi.advanceTimersByTimeAsync(1_000);
    expect(await result).toMatchObject({ ok: true });
    expect(send.mock.calls.filter(([, m]) => m.type === 'DELETE_CURRENT_GUEST_CHAT')).toHaveLength(1);
    expect(chats[0].cleanupStatus).toBe('deleted'); expect(chats[1].cleanupStatus).toBe('unreviewed');
  });
  it('keeps failed records and the review session after partial success', async () => {
    send.mockImplementation(async (_id, message) => message.id === 'two' ? { ok: false, error: 'Claude menu missing' } : { ok: true });
    const result = await deleteChats(['one', 'two']);
    expect(result).toMatchObject({ ok: false, error: '1 of 2 chats deleted. Claude menu missing', state: { lastGuestSessionId: 'session' } });
    expect(chats.map(c => c.cleanupStatus)).toEqual(['deleted', 'failed']);
    expect(remove).toHaveBeenCalledTimes(2);
  });
  it('persists uncertainty on disconnect and never automatically repeats confirmation', async () => {
    send.mockImplementation(async (_id, message) => { if (message.type === 'DELETE_CURRENT_GUEST_CHAT') throw new Error('Disconnected'); return { ok: true }; });
    expect(await deleteChats(['one'])).toMatchObject({ ok: false });
    expect(chats[0].cleanupStatus).toBe('unknown');
    await deleteChats(['one']);
    expect(send.mock.calls.filter(([, m]) => m.type === 'DELETE_CURRENT_GUEST_CHAT')).toHaveLength(1);
  });
  it('limits guest requests to their own provider and session', async () => {
    chats = [chat('one'), chat('one', 'chatgpt'), { ...chat('old'), sessionId: 'old-session' }];
    await deleteChats(['one', 'old'], 'claude');
    expect(chats.map(c => c.cleanupStatus)).toEqual(['deleted', 'unreviewed', 'unreviewed']);
  });
  it('does not close the cleanup tab before the provider finishes deletion', async () => {
    let finish!: (value: { ok: true }) => void;
    send.mockImplementation(async (_id, message) => message.type === 'CLEANUP_READY' ? { ok: true } : new Promise(resolve => { finish = resolve; }));
    const result = deleteChats(['one']); await vi.advanceTimersByTimeAsync(1_000);
    expect(remove).not.toHaveBeenCalled();
    expect(chats[0].cleanupStatus).toBe('unknown');
    finish({ ok: true }); await result;
    expect(remove).toHaveBeenCalledTimes(1);
  });
  it('serves state reads while the service worker is waiting for a delete response', async () => {
    let finish!: (value: { ok: true }) => void;
    send.mockImplementation(async (_id, message) => message.type === 'CLEANUP_READY' ? { ok: true } : new Promise(resolve => { finish = resolve; }));
    await import('../../src/background/service-worker');
    const listener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];
    const deleted = vi.fn();
    listener({ type: 'DELETE_GUEST_CHATS', ids: ['one'] }, {} as chrome.runtime.MessageSender, deleted);
    await vi.advanceTimersByTimeAsync(0);
    const read = vi.fn();
    listener({ type: 'GET_STATE' }, {} as chrome.runtime.MessageSender, read);
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledWith({ ok: true, state });
    expect(deleted).not.toHaveBeenCalled();
    // Complete the queued deletion after verifying the read was not blocked.
    finish({ ok: true });
    // Provide the tab query needed when the successful review clears state.
    chrome.tabs.query = vi.fn().mockResolvedValue([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(deleted).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });
});
