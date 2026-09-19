import { createPin, cooldownForFailures, matchesPin } from './pin-service';
import { getChats, getPin, getState, keys, saveChats, saveState } from '../shared/storage';
import type { Request, Response } from '../shared/messages';
import type { LockState } from '../shared/types';
import { deleteChats } from './cleanup';
import { newConversationUrl, providerForUrl } from '../shared/policy';

let serial = Promise.resolve();
const queued = <T>(fn: () => Promise<T>) => { const next = serial.then(fn, fn); serial = next.then(() => undefined, () => undefined); return next; };
const protectedTabs = () => chrome.tabs.query({ url: ['https://chatgpt.com/*', 'https://claude.ai/*'] });
async function notifyTabs(state: LockState) { for (const tab of await protectedTabs()) if (tab.id) chrome.tabs.sendMessage(tab.id, { type: 'STATE_CHANGED', state }).catch(() => undefined); }
async function changeState(next: Omit<LockState, 'revision'>) { const current = await getState(); const state = { ...next, revision: current.revision + 1 }; await saveState(state); await notifyTabs(state); return state; }
async function lock(): Promise<Response> {
  const pin = await getPin(); if (!pin) return { ok: false, error: 'Create a PIN first.' };
  const session = crypto.randomUUID();
  // Durable intent is written before tabs are contacted.
  const state = await changeState({ phase: 'LOCKING', guestSessionId: session, lockedAt: Date.now() });
  await notifyTabs(state);
  const active = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (active?.id && active.url && providerForUrl(active.url)) await chrome.tabs.update(active.id, { url: newConversationUrl(active.url) });
  return { ok: true, state: await changeState({ phase: 'LOCKED', guestSessionId: session, lockedAt: state.lockedAt }) };
}
async function unlock(pinValue: string): Promise<Response> {
  const record = await getPin(); const state = await getState(); if (!record) return { ok: false, error: 'No PIN is configured.', state };
  if (record.cooldownUntil && record.cooldownUntil > Date.now()) return { ok: false, error: 'Try again shortly.', state };
  if (!await matchesPin(pinValue, record)) { record.failedAttempts++; const cooldown = cooldownForFailures(record.failedAttempts); record.cooldownUntil = cooldown ? Date.now() + cooldown : undefined; await chrome.storage.local.set({ [keys.pin]: record }); return { ok: false, error: 'Incorrect PIN.', state }; }
  record.failedAttempts = 0; record.cooldownUntil = undefined; await chrome.storage.local.set({ [keys.pin]: record });
  return { ok: true, state: await changeState({ phase: 'UNLOCKED', lastGuestSessionId: state.guestSessionId }) };
}
chrome.runtime.onMessage.addListener((request: Request, sender, sendResponse: (response: Response) => void) => {
  // Cleanup waits on a content script. That script must be able to read state
  // without waiting behind the cleanup operation itself.
  if (request.type === 'GET_STATE' || request.type === 'GET_GUEST_CHATS') {
    void (async (): Promise<Response> => {
      const state = await getState();
      if (request.type === 'GET_STATE') return { ok: true, state };
      const sessionId = state.guestSessionId ?? state.lastGuestSessionId;
      const provider = sender.tab?.url ? providerForUrl(sender.tab.url) : undefined;
      return { ok: true, chats: (await getChats()).filter(c => c.sessionId === sessionId && (!provider || c.provider === provider)) };
    })().then(sendResponse).catch(error => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  queued(async (): Promise<Response> => {
    if (request.type === 'GET_ACTIVE_PROVIDER') { const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0]; return { ok: true, provider: tab?.url ? providerForUrl(tab.url) : undefined }; }
    if (request.type === 'KEEP_GUEST_CHATS') { const state = await getState(); const chats = await getChats(); for (const chat of chats) if (chat.sessionId === state.lastGuestSessionId && request.ids.includes(chat.id)) chat.cleanupStatus = 'kept'; await saveChats(chats); return { ok: true, chats: chats.filter(c => c.sessionId === state.lastGuestSessionId), state: await changeState({ phase: 'UNLOCKED' }) }; }
    if (request.type === 'DELETE_GUEST_CHATS') {
      const provider = sender.tab?.url ? providerForUrl(sender.tab.url) : undefined;
      if (sender.tab && (!provider || sender.frameId !== 0)) return { ok: false, error: 'Unsupported cleanup request.' };
      const result = await deleteChats(request.ids, provider);
      if (result.ok && result.state?.phase === 'UNLOCKED') result.state = await changeState({ phase: 'UNLOCKED' });
      return result;
    }
    if (request.type === 'SET_PIN') { if (!/^\d{6,}$/.test(request.pin)) return { ok: false, error: 'Use at least six digits.' }; await chrome.storage.local.set({ [keys.pin]: await createPin(request.pin) }); return { ok: true, state: await changeState({ phase: 'UNLOCKED' }) }; }
    if (request.type === 'LOCK') return lock();
    if (request.type === 'UNLOCK') return unlock(request.pin);
    if (request.type === 'TRACK_GUEST_CHAT') { const state = await getState(); const provider = sender.tab?.url ? providerForUrl(sender.tab.url) : undefined; if (state.phase !== 'LOCKED' || request.revision !== state.revision || !sender.tab?.id || !provider || (request.provider && request.provider !== provider)) return { ok: false, error: 'Stale or unauthorized guest record.', state }; const chats = await getChats(); if (!chats.some(c => c.id === request.id && c.sessionId === state.guestSessionId && c.provider === provider)) { chats.push({ id: request.id, title: (request.title ?? 'New guest chat').replace(/\s+/g, ' ').trim().slice(0, 60) || 'New guest chat', provider, sessionId: state.guestSessionId!, tabId: sender.tab.id, documentId: request.documentId, createdAt: Date.now(), evidence: 'submission-route', confidence: 'verified', cleanupStatus: 'unreviewed' }); await saveChats(chats); } return { ok: true, state }; }
    return { ok: false, error: 'Unsupported request.' };
  }).then(sendResponse).catch(error => sendResponse({ ok: false, error: String(error) })); return true;
});
chrome.webNavigation.onHistoryStateUpdated.addListener(({ tabId }) => chrome.tabs.sendMessage(tabId, { type: 'CHECK_ROUTE' }).catch(() => undefined), { url: [{ hostEquals: 'chatgpt.com' }, { hostEquals: 'claude.ai' }] });
