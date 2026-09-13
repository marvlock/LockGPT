import { createPin, cooldownForFailures, matchesPin } from './pin-service';
import { getChats, getPin, getState, keys, saveChats, saveState } from '../shared/storage';
import type { Request, Response } from '../shared/messages';
import type { LockState } from '../shared/types';

let serial = Promise.resolve();
const queued = <T>(fn: () => Promise<T>) => { const next = serial.then(fn, fn); serial = next.then(() => undefined, () => undefined); return next; };
const chatgptTabs = () => chrome.tabs.query({ url: ['https://chatgpt.com/*'] });
async function notifyTabs(state: LockState) { for (const tab of await chatgptTabs()) if (tab.id) chrome.tabs.sendMessage(tab.id, { type: 'STATE_CHANGED', state }).catch(() => undefined); }
async function changeState(next: Omit<LockState, 'revision'>) { const current = await getState(); const state = { ...next, revision: current.revision + 1 }; await saveState(state); await notifyTabs(state); return state; }
async function lock(): Promise<Response> {
  const pin = await getPin(); if (!pin) return { ok: false, error: 'Create a PIN first.' };
  const session = crypto.randomUUID();
  // Durable intent is written before tabs are contacted.
  const state = await changeState({ phase: 'LOCKING', guestSessionId: session, lockedAt: Date.now() });
  await notifyTabs(state);
  const active = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (active?.id && active.url?.startsWith('https://chatgpt.com/')) await chrome.tabs.update(active.id, { url: 'https://chatgpt.com/' });
  return { ok: true, state: await changeState({ phase: 'LOCKED', guestSessionId: session, lockedAt: state.lockedAt }) };
}
async function unlock(pinValue: string): Promise<Response> {
  const record = await getPin(); const state = await getState(); if (!record) return { ok: false, error: 'No PIN is configured.', state };
  if (record.cooldownUntil && record.cooldownUntil > Date.now()) return { ok: false, error: 'Try again shortly.', state };
  if (!await matchesPin(pinValue, record)) { record.failedAttempts++; const cooldown = cooldownForFailures(record.failedAttempts); record.cooldownUntil = cooldown ? Date.now() + cooldown : undefined; await chrome.storage.local.set({ [keys.pin]: record }); return { ok: false, error: 'Incorrect PIN.', state }; }
  record.failedAttempts = 0; record.cooldownUntil = undefined; await chrome.storage.local.set({ [keys.pin]: record });
  return { ok: true, state: await changeState({ phase: 'UNLOCKED', lastGuestSessionId: state.guestSessionId }) };
}
const waitForComplete = async (tabId: number) => {
  if ((await chrome.tabs.get(tabId)).status === 'complete') return;
  return new Promise<void>((resolve, reject) => { const timeout = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); reject(new Error('Timed out waiting for ChatGPT.')); }, 20_000); const listener = (id: number, change: { status?: string }) => { if (id === tabId && change.status === 'complete') { clearTimeout(timeout); chrome.tabs.onUpdated.removeListener(listener); resolve(); } }; chrome.tabs.onUpdated.addListener(listener); });
};
async function deleteChats(ids: string[]): Promise<Response> {
  const state = await getState(); const sessionId = state.guestSessionId ?? state.lastGuestSessionId; if ((state.phase !== 'UNLOCKED' && state.phase !== 'LOCKED') || !sessionId) return { ok: false, error: 'Guest chats are not available for cleanup.', state };
  let chats = await getChats(); const selected = chats.filter(chat => chat.sessionId === sessionId && ids.includes(chat.id) && chat.cleanupStatus !== 'deleted');
  for (const chat of selected) { let tabId: number | undefined; try { const tab = await chrome.tabs.create({ url: `https://chatgpt.com/c/${chat.id}`, active: false }); if (!tab.id) throw new Error('Unable to open guest chat.'); tabId = tab.id; await waitForComplete(tabId); await new Promise(resolve => setTimeout(resolve, 500)); const result = await chrome.tabs.sendMessage(tabId, { type: 'DELETE_CURRENT_GUEST_CHAT', id: chat.id }) as { ok: boolean; error?: string }; chat.cleanupStatus = result.ok ? 'deleted' : 'failed'; } catch { chat.cleanupStatus = 'failed'; } finally { if (tabId) chrome.tabs.remove(tabId).catch(() => undefined); } }
  await saveChats(chats);
  // A post-unlock cleanup choice completes the review. During an active guest
  // session, retain its identity so guests can continue navigating their chats.
  const endState = state.phase === 'UNLOCKED' ? await changeState({ phase: 'UNLOCKED' }) : state;
  return { ok: true, chats: selected, state: endState };
}
chrome.runtime.onMessage.addListener((request: Request, sender, sendResponse: (response: Response) => void) => {
  queued(async (): Promise<Response> => {
    if (request.type === 'GET_STATE') return { ok: true, state: await getState() };
    if (request.type === 'GET_GUEST_CHATS') { const state = await getState(); const sessionId = state.guestSessionId ?? state.lastGuestSessionId; return { ok: true, chats: (await getChats()).filter(c => c.sessionId === sessionId) }; }
    if (request.type === 'KEEP_GUEST_CHATS') { const state = await getState(); const chats = await getChats(); for (const chat of chats) if (chat.sessionId === state.lastGuestSessionId && request.ids.includes(chat.id)) chat.cleanupStatus = 'kept'; await saveChats(chats); return { ok: true, chats: chats.filter(c => c.sessionId === state.lastGuestSessionId), state: await changeState({ phase: 'UNLOCKED' }) }; }
    if (request.type === 'DELETE_GUEST_CHATS') return deleteChats(request.ids);
    if (request.type === 'SET_PIN') { if (!/^\d{6,}$/.test(request.pin)) return { ok: false, error: 'Use at least six digits.' }; await chrome.storage.local.set({ [keys.pin]: await createPin(request.pin) }); return { ok: true, state: await changeState({ phase: 'UNLOCKED' }) }; }
    if (request.type === 'LOCK') return lock();
    if (request.type === 'UNLOCK') return unlock(request.pin);
    if (request.type === 'TRACK_GUEST_CHAT') { const state = await getState(); if (state.phase !== 'LOCKED' || request.revision !== state.revision || !sender.tab?.id) return { ok: false, error: 'Stale or unauthorized guest record.', state }; const chats = await getChats(); if (!chats.some(c => c.id === request.id && c.sessionId === state.guestSessionId)) { chats.push({ id: request.id, title: (request.title ?? 'New guest chat').replace(/\s+/g, ' ').trim().slice(0, 60) || 'New guest chat', sessionId: state.guestSessionId!, tabId: sender.tab.id, documentId: request.documentId, createdAt: Date.now(), evidence: 'submission-route', confidence: 'verified', cleanupStatus: 'unreviewed' }); await saveChats(chats); } return { ok: true, state }; }
    return { ok: false, error: 'Unsupported request.' };
  }).then(sendResponse).catch(error => sendResponse({ ok: false, error: String(error) })); return true;
});
chrome.webNavigation.onHistoryStateUpdated.addListener(({ tabId }) => chrome.tabs.sendMessage(tabId, { type: 'CHECK_ROUTE' }).catch(() => undefined), { url: [{ hostEquals: 'chatgpt.com' }] });
