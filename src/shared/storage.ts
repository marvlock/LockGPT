import type { GuestConversation, LockState, PinRecord } from './types';
export const keys = { state: 'lockState', pin: 'pinRecord', chats: 'guestChats' } as const;
export async function getState(): Promise<LockState> { const result = await chrome.storage.local.get(keys.state); return (result[keys.state] as LockState | undefined) ?? { phase: 'UNCONFIGURED', revision: 0 }; }
export async function saveState(state: LockState) { await chrome.storage.local.set({ [keys.state]: state }); }
export async function getPin(): Promise<PinRecord | undefined> { return (await chrome.storage.local.get(keys.pin))[keys.pin] as PinRecord | undefined; }
export async function getChats(): Promise<GuestConversation[]> { return ((await chrome.storage.local.get(keys.chats))[keys.chats] as GuestConversation[] | undefined) ?? []; }
export async function saveChats(chats: GuestConversation[]) { await chrome.storage.local.set({ [keys.chats]: chats }); }
