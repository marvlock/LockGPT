export function guestTitleFromPrompt(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return 'New guest chat';
  return normalized.length > 60 ? `${normalized.slice(0, 57).trimEnd()}…` : normalized;
}
