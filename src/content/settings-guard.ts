import { isSettingsUrl } from '../shared/policy';

const controls = 'button, a[href], [role="button"], [role="menuitem"]';
const marker = 'data-lockgpt-settings-blocked';
const normalize = (text: string | null) => (text ?? '').replace(/\s+/g, ' ').trim();
const settingsLabel = /^(?:(?:open|chatgpt|account) )?settings(?:\s|[.…]|$)/i;

export function isSettingsControl(element: Element): boolean {
  if (element.closest('#lockgpt-root')) return false;
  const href = element.getAttribute('href');
  if (href) {
    try {
      const url = new URL(href, location.href);
      if (url.origin === location.origin && isSettingsUrl(url.href)) return true;
    } catch { /* Not a navigable link. */ }
  }
  if (element.closest('[data-message-author-role], [contenteditable="true"]')) return false;
  const testId = element.getAttribute('data-testid') ?? '';
  if (/^(?:accounts?-profile-button|profile-button|user-menu-button|settings(?:-.*)?)$/i.test(testId)) return true;
  const names = [element.getAttribute('aria-label'), element.getAttribute('title'), element.textContent].map(normalize);
  return names.some(name => settingsLabel.test(name))
    || names.slice(0, 2).some(name => /^(?:open )?(?:profile|account|user)(?: menu| options)?$/i.test(name));
}

export function settingsControlFromTarget(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  let candidate = target.closest(controls);
  while (candidate) {
    if (isSettingsControl(candidate)) return candidate;
    candidate = candidate.parentElement?.closest(controls) ?? null;
  }
  return null;
}

export function hideSettingsControls() {
  document.querySelectorAll(controls).forEach(element => {
    if (isSettingsControl(element)) element.setAttribute(marker, '');
    else element.removeAttribute(marker);
  });
}

export function restoreSettingsControls() {
  document.querySelectorAll(`[${marker}]`).forEach(element => element.removeAttribute(marker));
}

export function hasSettingsDialog(): boolean {
  return [...document.querySelectorAll('dialog, [role="dialog"]')].some(dialog => {
    if (dialog.closest('#lockgpt-root') || dialog.hasAttribute('hidden') || dialog.getAttribute('aria-hidden') === 'true') return false;
    if (dialog.matches('dialog:not([open])')) return false;
    const labels = (dialog.getAttribute('aria-labelledby') ?? '').split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '');
    const names = [dialog.getAttribute('aria-label'), ...labels, ...[...dialog.querySelectorAll('h1, h2, [role="heading"]')].map(heading => heading.textContent)];
    return names.some(name => settingsLabel.test(normalize(name)))
      || /^settings(?:-|$)/i.test(dialog.getAttribute('data-testid') ?? '');
  });
}
