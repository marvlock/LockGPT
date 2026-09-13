import type { PinRecord } from '../shared/types';
const encoder = new TextEncoder();
const ITERATIONS = 310_000;
const toBase64 = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromBase64 = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
async function derive(pin: string, salt: Uint8Array, iterations: number) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt.buffer as ArrayBuffer, iterations }, material, 256);
}
export async function createPin(pin: string): Promise<PinRecord> { const salt = crypto.getRandomValues(new Uint8Array(16)); return { salt: toBase64(salt), verifier: toBase64(await derive(pin, salt, ITERATIONS)), iterations: ITERATIONS, version: 1, failedAttempts: 0 }; }
export async function matchesPin(pin: string, record: PinRecord) { const candidate = new Uint8Array(await derive(pin, fromBase64(record.salt), record.iterations)); const expected = fromBase64(record.verifier); return candidate.length === expected.length && candidate.every((byte, i) => byte === expected[i]); }
export function cooldownForFailures(failures: number) { return failures < 3 ? 0 : Math.min(60_000 * 2 ** (failures - 3), 15 * 60_000); }
