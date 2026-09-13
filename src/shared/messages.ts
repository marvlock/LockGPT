import type { GuestConversation, LockState } from './types';
export type Request =
  | { type: 'GET_STATE' }
  | { type: 'SET_PIN'; pin: string }
  | { type: 'LOCK' }
  | { type: 'UNLOCK'; pin: string }
  | { type: 'GET_GUEST_CHATS' }
  | { type: 'KEEP_GUEST_CHATS'; ids: string[] }
  | { type: 'DELETE_GUEST_CHATS'; ids: string[] }
  | { type: 'TRACK_GUEST_CHAT'; id: string; title?: string; revision: number; documentId?: string }
  | { type: 'CONTENT_READY'; revision: number };
export type Response = { ok: true; state?: LockState; chats?: GuestConversation[] } | { ok: false; error: string; state?: LockState };
