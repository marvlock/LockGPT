import type { Response } from '../shared/messages';
import type { LockState } from '../shared/types';
import { allowedWhileLocked, conversationIdFromUrl } from '../shared/policy';
import { guestTitleFromPrompt } from '../shared/title';

const root = document.createElement('div');
root.id = 'lockgpt-root';
document.documentElement.classList.add('lockgpt-pending');
document.documentElement.append(root);
let state: LockState | undefined;
let submittedFromBlank = false;
let pendingTitle = 'New guest chat';
let routeTimer: number | undefined;
let layoutTimer: number | undefined;

const ask = <T extends object>(message: T) => chrome.runtime.sendMessage(message) as Promise<Response>;
function cover(message = 'This ChatGPT conversation is hidden') {
  document.documentElement.classList.remove('lockgpt-guest');
  document.documentElement.classList.add('lockgpt-pending');
  root.innerHTML = `<div class="lockgpt-cover"><div class="lockgpt-card"><strong>LockGPT is protecting this page</strong><p>${message}</p><small>Owner unlocks through the LockGPT extension.</small></div></div>`;
}
async function showGuest() {
  document.documentElement.classList.remove('lockgpt-pending');
  document.documentElement.classList.add('lockgpt-guest');
  const chatsResponse = await ask({ type: 'GET_GUEST_CHATS' });
  const chats = chatsResponse.ok ? (chatsResponse.chats ?? []).filter(chat => chat.cleanupStatus !== 'deleted') : [];
  root.innerHTML = `<div class="lockgpt-banner">Guest mode · Your conversations may remain in this account · Owner unlocks through LockGPT</div>
    <section class="lockgpt-panel" aria-label="Guest conversations">
      <button class="lockgpt-new" type="button">+ New chat</button>
      <p class="lockgpt-panel-title">This guest session</p>
      <div class="lockgpt-chat-list">${chats.length ? chats.map(chat => `<div class="lockgpt-chat-row"><button class="lockgpt-chat" type="button" data-chat-id="${chat.id}">${escapeHtml(chat.title)}</button><button class="lockgpt-delete" type="button" data-delete-id="${chat.id}" aria-label="Delete ${escapeHtml(chat.title)}">⌫</button></div>`).join('') : '<p class="lockgpt-empty">Your new chats will appear here.</p>'}</div>
      <p class="lockgpt-help">Owner unlocks through LockGPT</p>
    </section>`;
  root.querySelector<HTMLButtonElement>('.lockgpt-new')?.addEventListener('click', () => { location.href = '/'; });
  root.querySelectorAll<HTMLButtonElement>('[data-chat-id]').forEach(button => button.addEventListener('click', () => { location.href = `/c/${button.dataset.chatId}`; }));
  root.querySelectorAll<HTMLButtonElement>('[data-delete-id]').forEach(button => button.addEventListener('click', async () => { const id = button.dataset.deleteId; if (!id || !confirm('Delete this guest chat? This cannot be undone.')) return; button.disabled = true; const result = await ask({ type: 'DELETE_GUEST_CHATS', ids: [id] }); if (!result.ok) { button.disabled = false; alert(result.error); return; } await applyPolicy(); }));
}
function escapeHtml(value: string) { const node = document.createElement('span'); node.textContent = value; return node.innerHTML; }
function showUnlocked() { document.documentElement.classList.remove('lockgpt-pending', 'lockgpt-guest'); root.replaceChildren(); }
function hasRecognizedComposer() { return Boolean(document.querySelector('textarea, [contenteditable="true"]')); }
async function applyPolicy() {
  const response = await ask({ type: 'GET_STATE' });
  if (!response.ok || !response.state) return cover('Guest mode is temporarily unavailable. Unlock to continue.');
  state = response.state;
  if (state.phase === 'UNCONFIGURED' || state.phase === 'UNLOCKED') return showUnlocked();
  if (state.phase !== 'LOCKED' && state.phase !== 'LOCKING') return cover('Guest mode is temporarily unavailable. Unlock to continue.');
  const chats = await ask({ type: 'GET_GUEST_CHATS' });
  const guestIds = new Set(chats.ok ? (chats.chats ?? []).map(chat => chat.id) : []);
  if (!allowedWhileLocked(location.href, state, guestIds)) return cover();
  // A route is never safe solely because its path looks new; require a native composer.
  if (!hasRecognizedComposer()) return cover('Guest mode is temporarily unavailable. Unlock to continue.');
  await showGuest();
}
function observeSubmission(event: Event) {
  if (!state || state.phase !== 'LOCKED') return;
  const target = event.target as HTMLElement | null;
  if (location.pathname === '/' && (target?.matches('form') || target?.closest('form'))) { pendingTitle = guestTitleFromPrompt((target?.querySelector('textarea, [contenteditable="true"]') as HTMLTextAreaElement | HTMLElement | null)?.textContent || (target?.querySelector('textarea') as HTMLTextAreaElement | null)?.value || ''); submittedFromBlank = true; }
}
async function trackAfterNavigation() {
  if (!submittedFromBlank || !state || state.phase !== 'LOCKED') return;
  const id = conversationIdFromUrl(location.href);
  if (!id) return;
  submittedFromBlank = false;
  await ask({ type: 'TRACK_GUEST_CHAT', id, title: pendingTitle, revision: state.revision });
  applyPolicy();
}
document.addEventListener('submit', observeSubmission, true);
document.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && location.pathname === '/') { const target = event.target as HTMLTextAreaElement | HTMLElement; pendingTitle = guestTitleFromPrompt(target instanceof HTMLTextAreaElement ? target.value : target.textContent ?? ''); submittedFromBlank = true; } }, true);
chrome.runtime.onMessage.addListener((message: { type: string; state?: LockState; id?: string }, _sender, sendResponse) => {
  if (message.type === 'STATE_CHANGED' && message.state) { state = message.state; applyPolicy(); }
  if (message.type === 'CHECK_ROUTE') { clearTimeout(routeTimer); routeTimer = window.setTimeout(() => { trackAfterNavigation(); applyPolicy(); }, 80); }
  if (message.type === 'DELETE_CURRENT_GUEST_CHAT' && message.id) { void deleteCurrentGuestChat(message.id).then(sendResponse); return true; }
});
const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
async function waitFor<T>(find: () => T | undefined, timeout = 12_000): Promise<T | undefined> { const end = Date.now() + timeout; while (Date.now() < end) { const found = find(); if (found) return found; await delay(100); } return undefined; }
async function deleteCurrentGuestChat(id: string): Promise<{ ok: boolean; error?: string }> {
  // Delete through the conversation's sidebar row so the action is bound to
  // the exact recorded ID, never to an arbitrary visible conversation.
  // This runs only in a background cleanup tab. The native sidebar must be
  // present to target the exact conversation row rather than another chat.
  document.documentElement.classList.remove('lockgpt-guest');
  const link = await waitFor(() => [...document.querySelectorAll<HTMLAnchorElement>('a[href*="/c/"]')].find(anchor => /\/c\/([^/?#]+)/.exec(anchor.getAttribute('href') ?? '')?.[1] === id));
  const row = link?.closest('li, [data-sidebar-item="true"]') ?? link?.parentElement;
  const menu = row ? [...row.querySelectorAll<HTMLButtonElement>('button')].find(button => button.matches('[data-testid$="-options"]') || /conversation options|more options/i.test(button.getAttribute('aria-label') ?? '')) : undefined;
  if (!menu) return { ok: false, error: 'The selected ChatGPT conversation menu was not recognized.' };
  menu.click();
  const deleteItem = await waitFor(() => document.querySelector<HTMLElement>('[data-testid="delete-chat-menu-item"]') ?? [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => /^delete$/i.test((item.textContent ?? '').trim())));
  if (!deleteItem) return { ok: false, error: 'ChatGPT delete action was not recognized.' };
  deleteItem.click();
  const confirm = await waitFor(() => document.querySelector<HTMLButtonElement>('[data-testid="delete-conversation-confirm-button"]') ?? [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => /^delete$/i.test((button.textContent ?? '').trim())));
  if (!confirm) return { ok: false, error: 'ChatGPT deletion confirmation was not recognized.' };
  confirm.click();
  await delay(500);
  return { ok: !confirm.isConnected, error: confirm.isConnected ? 'ChatGPT did not confirm deletion.' : undefined };
}
new MutationObserver(records => {
  // ChatGPT mounts its composer asynchronously. Keep the page covered until a
  // recognized composer exists, then reveal only the allowed guest route. Do
  // not react to LockGPT's own panel render: rebuilding it can swallow clicks.
  if (records.every(record => root.contains(record.target))) return;
  if (state?.phase !== 'LOCKED' && state?.phase !== 'LOCKING') return;
  clearTimeout(layoutTimer);
  layoutTimer = window.setTimeout(() => applyPolicy(), 100);
}).observe(document.documentElement, { childList: true, subtree: true });
applyPolicy();
