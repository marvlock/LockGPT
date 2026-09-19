import type { Response } from '../shared/messages';
import type { GuestConversation, LockState } from '../shared/types';
import { allowedWhileLocked, conversationIdFromUrl, isNewChatUrl, isSettingsUrl, newConversationUrl, providerForUrl, providerLabel } from '../shared/policy';
import { guestTitleFromPrompt } from '../shared/title';
import { iconMarkup } from '../shared/icons';
import { deleteChat } from './delete-chat';
import { hasSettingsDialog, hideSettingsControls, restoreSettingsControls, settingsControlFromTarget } from './settings-guard';

const root = document.createElement('div');
root.id = 'lockgpt-root';
document.documentElement.classList.add('lockgpt-pending');
document.documentElement.append(root);
let state: LockState | undefined;
let pendingSubmission: { title: string; revision: number } | undefined;
let tracking: { id: string; revision: number; promise: Promise<void> } | undefined;
let policyRun = 0;
let approvedRoute: { url: string; revision: number } | undefined;
let routeTimer: number | undefined;
let layoutTimer: number | undefined;
let sidebarOpen = false;
let coverTimer: number | undefined;
let coverKey: string | undefined;
let cleanupRunning = false;
let deletingGuestChat = false;

const ask = <T extends object>(message: T) => chrome.runtime.sendMessage(message) as Promise<Response>;
function routeKey(url: string) {
  const parsed = new URL(url);
  return parsed.origin + (parsed.pathname.replace(/\/$/, '') || '/');
}
function clearCoverNotice() {
  clearTimeout(coverTimer);
  coverTimer = undefined;
  coverKey = undefined;
}
function activeProviderName() { return providerLabel(providerForUrl(location.href) ?? 'chatgpt'); }
function cover(message = `This ${activeProviderName()} conversation is hidden`, heading = 'This conversation is private') {
  document.documentElement.classList.remove('lockgpt-guest');
  document.documentElement.classList.add('lockgpt-pending');
  const route = routeKey(location.href);
  const key = JSON.stringify([route, message, heading]);
  if (coverKey === key) return;
  clearCoverNotice();
  coverKey = key;
  // Block access immediately, but do not flash a warning for a transient
  // mount/loading state. Repeated DOM checks must not restart this timer.
  root.innerHTML = '<div class="lockgpt-cover" role="status" aria-label="Checking guest access"></div>';
  coverTimer = window.setTimeout(() => {
    if (coverKey !== key || routeKey(location.href) !== route) return;
    const surface = root.querySelector('.lockgpt-cover');
    if (!surface) return;
    surface.removeAttribute('aria-label');
    surface.innerHTML = `<div class="lockgpt-card"><div class="lockgpt-cover-icon">${iconMarkup('lock')}</div><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(message)}</p><small>Open LockGPT in your browser toolbar to unlock.</small></div>`;
  }, 300);
}
function coverUnavailable() {
  cover('Unable to verify guest access. Unlock to continue.', 'Guest mode is temporarily unavailable');
}
function isGuestLocked() { return state?.phase === 'LOCKED' || state?.phase === 'LOCKING'; }
function enforceSettingsBoundary() {
  if (!isGuestLocked()) return false;
  hideSettingsControls();
  if (!isSettingsUrl(location.href) && !hasSettingsDialog()) return false;
  pendingSubmission = undefined;
  cover('Go back to your chat, or ask the owner to unlock LockGPT.', 'Settings are locked during guest mode');
  return true;
}
function guardSettingsInteraction(event: Event) {
  if (!isGuestLocked()) return;
  if (event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ') return;
  if (!settingsControlFromTarget(event.target)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  hideSettingsControls();
}
function showGuest(chats: GuestConversation[], url: string) {
  if (deletingGuestChat && root.querySelector('.lockgpt-panel')) return;
  clearCoverNotice();
  document.documentElement.classList.remove('lockgpt-pending');
  document.documentElement.classList.add('lockgpt-guest');
  chats = chats.filter(chat => chat.cleanupStatus !== 'deleted');
  const currentId = conversationIdFromUrl(url);
  const provider = providerForUrl(url);
  if (!provider) return coverUnavailable();
  root.innerHTML = `<button class="lockgpt-sidebar-toggle" type="button" aria-label="Toggle guest sidebar" aria-expanded="${sidebarOpen}" aria-controls="lockgpt-sidebar">${iconMarkup('sidebar')}</button>
    <section id="lockgpt-sidebar" class="lockgpt-panel${sidebarOpen ? ' is-open' : ''}" aria-label="Guest conversations">
      <div class="lockgpt-panel-header"><span>${providerLabel(provider)}</span><span class="lockgpt-mode">Guest</span></div>
      <button class="lockgpt-new" type="button">${iconMarkup('compose')}<span>New chat</span></button>
      <h2 class="lockgpt-panel-title">Your chats</h2>
      <div class="lockgpt-chat-list">${chats.length ? chats.map(chat => `<div class="lockgpt-chat-row${chat.id === currentId ? ' is-active' : ''}"><button class="lockgpt-chat" type="button" data-chat-id="${escapeHtml(chat.id)}" ${chat.id === currentId ? 'aria-current="page"' : ''}><span>${escapeHtml(chat.title)}</span></button><button class="lockgpt-delete" type="button" data-delete-id="${escapeHtml(chat.id)}" aria-label="Delete ${escapeHtml(chat.title)}">${iconMarkup('trash')}</button></div>`).join('') : '<p class="lockgpt-empty">Chats you start here will appear in this session.</p>'}</div>
      <div class="lockgpt-help"><div>${iconMarkup('lock')}<span>Guest session</span></div><p>Existing chats are hidden. Guest chats may stay in this account.</p><p>Open LockGPT in the toolbar to unlock.</p></div>
    </section>`;
  root.querySelector<HTMLButtonElement>('.lockgpt-sidebar-toggle')?.addEventListener('click', event => {
    sidebarOpen = !sidebarOpen;
    (event.currentTarget as HTMLButtonElement).setAttribute('aria-expanded', String(sidebarOpen));
    root.querySelector('.lockgpt-panel')?.classList.toggle('is-open', sidebarOpen);
  });
  root.querySelector<HTMLButtonElement>('.lockgpt-new')?.addEventListener('click', () => { location.href = newConversationUrl(location.href); });
  root.querySelectorAll<HTMLButtonElement>('[data-chat-id]').forEach(button => button.addEventListener('click', () => { location.href = provider === 'claude' ? `/chat/${button.dataset.chatId}` : `/c/${button.dataset.chatId}`; }));
  root.querySelectorAll<HTMLButtonElement>('[data-delete-id]').forEach(button => button.addEventListener('click', async () => {
    const id = button.dataset.deleteId;
    if (!id || deletingGuestChat || !confirm('Delete this guest chat? This cannot be undone.')) return;
    deletingGuestChat = true;
    root.querySelectorAll<HTMLButtonElement>('[data-delete-id]').forEach(control => { control.disabled = true; });
    button.setAttribute('aria-label', 'Deleting chat…');
    try {
      const result = await ask({ type: 'DELETE_GUEST_CHATS', ids: [id] });
      if (!result.ok) alert(result.error);
      else if (conversationIdFromUrl(location.href) === id) location.href = newConversationUrl(location.href);
    } catch { alert('Deletion could not be confirmed. Check the chat on the site.'); }
    finally { deletingGuestChat = false; void applyPolicy(); }
  }));
}
function escapeHtml(value: string) { const node = document.createElement('span'); node.textContent = value; return node.innerHTML.replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
function showUnlocked() { clearCoverNotice(); restoreSettingsControls(); document.documentElement.classList.remove('lockgpt-pending', 'lockgpt-guest'); root.replaceChildren(); }
function hasRecognizedComposer() { return Boolean(document.querySelector('textarea, [contenteditable="true"]')); }
async function applyPolicy() {
  if (cleanupRunning) return;
  const run = ++policyRun;
  const url = location.href;
  const isCurrent = () => !cleanupRunning && run === policyRun && url === location.href;
  try {
    const response = await ask({ type: 'GET_STATE' });
    if (!isCurrent()) return;
    if (!response.ok || !response.state) return coverUnavailable();
    state = response.state;
    const currentState = state;
    if (state.phase === 'UNCONFIGURED' || state.phase === 'UNLOCKED') {
      pendingSubmission = undefined;
      approvedRoute = undefined;
      return showUnlocked();
    }
    if (state.phase !== 'LOCKED' && state.phase !== 'LOCKING') return coverUnavailable();
    if (enforceSettingsBoundary()) return;

    // Both navigation and DOM updates can arrive before storage records the new
    // conversation. All checks must await that same registration before deciding.
    await trackAfterNavigation(currentState, url);
    if (!isCurrent()) return;
    const chats = await ask({ type: 'GET_GUEST_CHATS' });
    if (!isCurrent()) return;
    if (!chats.ok) return coverUnavailable();
    const guestIds = new Set((chats.chats ?? []).filter(chat => chat.cleanupStatus !== 'deleted').map(chat => chat.id));
    if (!allowedWhileLocked(url, currentState, guestIds)) return cover();
    // Require a composer on first entry. ChatGPT can temporarily remount it
    // during submission, which does not revoke an already-approved route.
    const alreadyApproved = approvedRoute?.url === routeKey(url) && approvedRoute.revision === currentState.revision;
    const registeredGuest = guestIds.has(conversationIdFromUrl(url) ?? '');
    if (!hasRecognizedComposer() && !alreadyApproved && !registeredGuest) return coverUnavailable();
    approvedRoute = { url: routeKey(url), revision: currentState.revision };
    showGuest(chats.chats ?? [], url);
  } catch {
    if (isCurrent()) coverUnavailable();
  }
}
function observeSubmission(event: Event) {
  if (!state || state.phase !== 'LOCKED' || !isNewChatUrl(location.href)) return;
  const target = event.target;
  if (!(target instanceof Element) || target.closest('#lockgpt-root')) return;
  const composerSelector = 'textarea, [contenteditable="true"], [contenteditable="plaintext-only"]';
  let composer: HTMLTextAreaElement | HTMLElement | null | undefined;
  if (event.type === 'click') {
    const button = target.closest<HTMLButtonElement>('button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Send message"]');
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
    if (event instanceof MouseEvent && event.button !== 0) return;
    composer = button.closest('form')?.querySelector<HTMLTextAreaElement | HTMLElement>(composerSelector)
      ?? document.querySelector<HTMLElement>('#prompt-textarea');
  } else {
    composer = event.type === 'submit'
      ? target.closest('form')?.querySelector<HTMLTextAreaElement | HTMLElement>(composerSelector)
      : target.closest<HTMLTextAreaElement | HTMLElement>(composerSelector);
  }
  if (!composer) return;
  const prompt = composer instanceof HTMLTextAreaElement ? composer.value : composer.textContent ?? '';
  if (!prompt.trim()) return;
  pendingSubmission = { title: guestTitleFromPrompt(prompt), revision: state.revision };
}
async function trackAfterNavigation(currentState: LockState, url: string) {
  const id = conversationIdFromUrl(url);
  if (!id || currentState.phase !== 'LOCKED') return;
  if (tracking?.id === id && tracking.revision === currentState.revision) return tracking.promise;
  const submission = pendingSubmission;
  if (!submission || submission.revision !== currentState.revision) return;
  pendingSubmission = undefined;
  const provider = providerForUrl(url);
  if (!provider) return;
  const promise = ask({ type: 'TRACK_GUEST_CHAT', id, title: submission.title, provider, revision: submission.revision }).then(result => {
    if (!result.ok) throw new Error(result.error);
  });
  const registration = { id, revision: currentState.revision, promise };
  tracking = registration;
  try {
    await promise;
    if (location.href === url && approvedRoute?.revision === currentState.revision && new URL(approvedRoute.url).pathname === '/') {
      approvedRoute = { url: routeKey(url), revision: currentState.revision };
    }
  }
  finally { if (tracking === registration) tracking = undefined; }
}

document.addEventListener('submit', observeSubmission, true);
for (const event of ['pointerdown', 'click', 'auxclick', 'keydown']) {
  document.addEventListener(event, guardSettingsInteraction, true);
}
// Capture before ChatGPT clears its editor; modern composers can send without
// dispatching a native form-submit event.
document.addEventListener('click', observeSubmission, true);
function onRouteChange() {
  if (enforceSettingsBoundary()) { ++policyRun; return; }
  void applyPolicy();
}
window.addEventListener('hashchange', onRouteChange);
window.addEventListener('popstate', onRouteChange);
document.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) observeSubmission(event);
}, true);
chrome.runtime.onMessage.addListener((message: { type: string; state?: LockState; id?: string }, _sender, sendResponse) => {
  if (message.type === 'CLEANUP_READY') { sendResponse({ ok: true }); return; }
  if (message.type === 'STATE_CHANGED' && message.state) { state = message.state; applyPolicy(); }
  if (message.type === 'CHECK_ROUTE') { clearTimeout(routeTimer); if (enforceSettingsBoundary()) { ++policyRun; return; } routeTimer = window.setTimeout(() => { void applyPolicy(); }, 80); }
  if (message.type === 'DELETE_CURRENT_GUEST_CHAT' && message.id && !cleanupRunning) { void deleteCurrentGuestChat(message.id).then(sendResponse).catch(() => sendResponse({ ok: false, uncertain: true, error: 'Cleanup stopped unexpectedly. Check the chat before retrying.' })); return true; }
});
// Cleanup owns this document until the background closes its dedicated tab.
async function deleteCurrentGuestChat(id: string) {
  cleanupRunning = true;
  ++policyRun;
  clearTimeout(layoutTimer);
  clearTimeout(routeTimer);
  cover('Removing the selected guest chat. Please wait.', 'Deleting guest chat');
  return deleteChat(id);
}
new MutationObserver(records => {
  if (cleanupRunning) return;
  // ChatGPT mounts its composer asynchronously. Keep the page covered until a
  // recognized composer exists, then reveal only the allowed guest route. Do
  // not react to LockGPT's own panel render: rebuilding it can swallow clicks.
  if (records.every(record => root.contains(record.target))) return;
  if (state?.phase !== 'LOCKED' && state?.phase !== 'LOCKING') return;
  if (enforceSettingsBoundary()) { ++policyRun; return; }
  clearTimeout(layoutTimer);
  layoutTimer = window.setTimeout(() => applyPolicy(), 100);
}).observe(document.documentElement, { childList: true, subtree: true });
applyPolicy();
