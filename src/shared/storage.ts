import type { GuestConversation, LockState, PinRecord } from './types';
export const keys = { state: 'lockState', pin: 'pinRecord', chats: 'guestChats' } as const;
export async function getState(): Promise<LockState> { const result = await chrome.storage.local.get(keys.state); return (result[keys.state] as LockState | undefined) ?? { phase: 'UNCONFIGURED', revision: 0 }; }
export async function saveState(state: LockState) { await chrome.storage.local.set({ [keys.state]: state }); }
export async function getPin(): Promise<PinRecord | undefined> { return (await chrome.storage.local.get(keys.pin))[keys.pin] as PinRecord | undefined; }
export async function getChats(): Promise<GuestConversation[]> {
  const chats = ((await chrome.storage.local.get(keys.chats))[keys.chats] as Array<GuestConversation & { provider?: GuestConversation['provider'] }> | undefined) ?? [];
  // Guest records from LockGPT 0.1.0 predate multi-provider support. They
  // were necessarily created on ChatGPT, so keep them available after upgrade.
  return chats.map(chat => ({ ...chat, provider: chat.provider ?? 'chatgpt' }));
}
export async function saveChats(chats: GuestConversation[]) { await chrome.storage.local.set({ [keys.chats]: chats }); }
