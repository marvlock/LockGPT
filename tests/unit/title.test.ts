import { describe, expect, it } from 'vitest';
import { guestTitleFromPrompt } from '../../src/shared/title';
describe('guest chat titles', () => {
  it('normalizes a first prompt into a compact title', () => expect(guestTitleFromPrompt('  Plan\nmy trip  ')).toBe('Plan my trip'));
  it('truncates titles without retaining the complete long prompt', () => expect(guestTitleFromPrompt('a'.repeat(100))).toHaveLength(58));
});
