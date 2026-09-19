export type LockPhase = 'UNCONFIGURED' | 'UNLOCKED' | 'LOCKING' | 'LOCKED' | 'UNLOCKING' | 'ERROR';
export type Provider = 'chatgpt' | 'claude';
export interface LockState { phase: LockPhase; revision: number; guestSessionId?: string; lastGuestSessionId?: string; lockedAt?: number; error?: string; }
export interface PinRecord { salt: string; verifier: string; iterations: number; version: 1; failedAttempts: number; cooldownUntil?: number; }
export interface GuestConversation { id: string; title: string; provider: Provider; sessionId: string; tabId: number; documentId?: string; createdAt: number; evidence: 'submission-route'; confidence: 'verified'; cleanupStatus: 'unreviewed' | 'kept' | 'deleted' | 'failed' | 'unknown'; cleanupError?: string; }
export const INITIAL_STATE: LockState = { phase: 'UNCONFIGURED', revision: 0 };
