import type { LockState } from './types';

export function conversationIdFromUrl(url: string): string | undefined {
  const match = new URL(url).pathname.match(/^\/c\/([a-zA-Z0-9-]+)\/?$/);
  return match?.[1];
}
export function isNewChatUrl(url: string): boolean { return new URL(url).pathname === '/'; }
export function isSettingsUrl(url: string): boolean {
  const parsed = new URL(url);
  let hash = parsed.hash.slice(1);
  try { hash = decodeURIComponent(hash); } catch { /* Match malformed fragments as written. */ }
  return /^\/settings(?:\/|$)/i.test(parsed.pathname)
    || /^\/?settings(?:[/?=&]|$)/i.test(hash)
    || parsed.searchParams.has('settings')
    || ['modal', 'dialog'].some(key => /^settings(?:\/|$)/i.test(parsed.searchParams.get(key) ?? ''));
}
export function allowedWhileLocked(url: string, state: LockState, guestIds: Set<string>): boolean {
  if (state.phase !== 'LOCKED' && state.phase !== 'LOCKING') return true;
  if (isSettingsUrl(url)) return false;
  return isNewChatUrl(url) || (!!conversationIdFromUrl(url) && guestIds.has(conversationIdFromUrl(url)!));
}
