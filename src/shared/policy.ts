import type { LockState } from './types';

export function conversationIdFromUrl(url: string): string | undefined {
  const match = new URL(url).pathname.match(/^\/c\/([a-zA-Z0-9-]+)\/?$/);
  return match?.[1];
}
export function isNewChatUrl(url: string): boolean { return new URL(url).pathname === '/'; }
export function allowedWhileLocked(url: string, state: LockState, guestIds: Set<string>): boolean {
  if (state.phase !== 'LOCKED' && state.phase !== 'LOCKING') return true;
  return isNewChatUrl(url) || (!!conversationIdFromUrl(url) && guestIds.has(conversationIdFromUrl(url)!));
}
