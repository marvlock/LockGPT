import type { LockState, Provider } from './types';

export function providerForUrl(url: string): Provider | undefined {
  const host = new URL(url).hostname;
  if (host === 'chatgpt.com') return 'chatgpt';
  if (host === 'claude.ai') return 'claude';
  return undefined;
}
export function providerLabel(provider: Provider) { return provider === 'claude' ? 'Claude' : 'ChatGPT'; }
export function newConversationUrl(url: string) { return providerForUrl(url) === 'claude' ? 'https://claude.ai/new' : 'https://chatgpt.com/'; }
export function conversationIdFromUrl(url: string): string | undefined {
  const parsed = new URL(url);
  const expression = providerForUrl(url) === 'claude' ? /^\/chat\/([a-zA-Z0-9-]+)\/?$/ : /^\/c\/([a-zA-Z0-9-]+)\/?$/;
  return parsed.pathname.match(expression)?.[1];
}
export function isNewChatUrl(url: string): boolean { const parsed = new URL(url); return providerForUrl(url) === 'claude' ? parsed.pathname === '/new' || parsed.pathname === '/' : parsed.pathname === '/'; }
export function isSettingsUrl(url: string): boolean {
  const parsed = new URL(url); let hash = parsed.hash.slice(1); try { hash = decodeURIComponent(hash); } catch { /* Match malformed fragments as written. */ }
  return /^\/settings(?:\/|$)/i.test(parsed.pathname) || /^\/?settings(?:[/?=&]|$)/i.test(hash) || parsed.searchParams.has('settings') || ['modal', 'dialog'].some(key => /^settings(?:\/|$)/i.test(parsed.searchParams.get(key) ?? ''));
}
export function allowedWhileLocked(url: string, state: LockState, guestIds: Set<string>): boolean {
  if (state.phase !== 'LOCKED' && state.phase !== 'LOCKING') return true;
  return !isSettingsUrl(url) && (isNewChatUrl(url) || (!!conversationIdFromUrl(url) && guestIds.has(conversationIdFromUrl(url)!)));
}
