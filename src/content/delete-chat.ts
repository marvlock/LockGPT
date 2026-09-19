import { conversationIdFromUrl, isNewChatUrl, providerForUrl, providerLabel } from '../shared/policy';

export type DeleteResult = { ok: true } | { ok: false; error: string; uncertain?: boolean };
const pause = () => new Promise(resolve => setTimeout(resolve, 100));

/**
 * Claude's web app owns conversations beneath an organization. Deleting via
 * this same-origin endpoint uses the signed-in Claude session and avoids
 * depending on a transient title-menu implementation. We try each available
 * organization because a personal account can belong to more than one.
 */
export async function deleteClaudeConversation(id: string): Promise<DeleteResult> {
  try {
    const organizationsResponse = await fetch('/api/organizations', { credentials: 'include', headers: { accept: 'application/json' } });
    if (!organizationsResponse.ok) return { ok: false, error: `Claude could not load the signed-in account (${organizationsResponse.status}).` };
    const payload: unknown = await organizationsResponse.json();
    const organizations = Array.isArray(payload) ? payload : payload && typeof payload === 'object' && Array.isArray((payload as { organizations?: unknown }).organizations) ? (payload as { organizations: unknown[] }).organizations : [];
    const ids = organizations.map(org => org && typeof org === 'object' ? (org as { uuid?: unknown }).uuid : undefined).filter((uuid): uuid is string => typeof uuid === 'string' && /^[a-zA-Z0-9-]+$/.test(uuid));
    if (!ids.length) return { ok: false, error: 'Claude did not return an account workspace for this chat.' };
    let lastStatus = 404;
    for (const organizationId of ids) {
      const response = await fetch(`/api/organizations/${encodeURIComponent(organizationId)}/chat_conversations/${encodeURIComponent(id)}`, {
        method: 'DELETE', credentials: 'include', headers: { accept: 'application/json' },
      });
      if (response.ok) return { ok: true };
      lastStatus = response.status;
      // A conversation may belong to a different workspace. Only continue
      // across organizations when the provider says this ID is absent there.
      if (response.status !== 404) break;
    }
    return { ok: false, error: `Claude did not delete this chat (${lastStatus}).` };
  } catch {
    return { ok: false, error: 'Claude could not reach its conversation service.' };
  }
}
// Ignore stale menus, hidden templates, and LockGPT's own delete controls.
// The cleanup curtain intentionally hides the application with visibility, so
// visibility is not a suitable test here. Display/hidden still detect closed UI.
function available(element: HTMLElement) {
  if (!element.isConnected || element.closest('#lockgpt-root, [hidden], [aria-hidden="true"], [data-state="closed"]')) return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (getComputedStyle(node).display === 'none') return false;
  }
  return !element.matches(':disabled, [aria-disabled="true"]');
}
const candidates = (scope: ParentNode, selector: string) => [...scope.querySelectorAll<HTMLElement>(selector)].filter(available);
function exactChatLinks(id: string) {
  return [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].filter(link => {
    if (link.closest('#lockgpt-root')) return false;
    try { return new URL(link.href).origin === location.origin && conversationIdFromUrl(link.href) === id; } catch { return false; }
  });
}
function findTrigger(id: string, claude: boolean): HTMLElement | undefined {
  for (const link of exactChatLinks(id)) {
    // Only walk through a row containing this exact chat, never the whole list.
    for (let row: HTMLElement | null = link, depth = 0; row && depth < 4; row = row.parentElement, depth++) {
      const ids = new Set([...row.querySelectorAll<HTMLAnchorElement>('a[href]')].map(a => conversationIdFromUrl(a.href)).filter(Boolean));
      if ([...ids].some(value => value !== id)) break;
      const buttons = candidates(row, 'button, [role="button"]');
      const trigger = buttons.find(button => button.matches('[data-testid$="-options"], [aria-haspopup="menu"]') || /^(?:more|more options|chat options|conversation options|open conversation options(?: for .+)?)$/i.test(button.getAttribute('aria-label') ?? ''));
      if (trigger) return trigger;
    }
  }
  if (claude) {
    // Split title controls can contain the button rather than be the button.
    for (const title of candidates(document, '[data-testid="chat-title-split"], [data-testid="chat-menu-trigger"], [data-testid*="conversation-menu"], [data-testid*="chat-options"]')) {
      const trigger = title.matches('button, [role="button"]') ? title : title.closest<HTMLElement>('button, [role="button"]') ?? candidates(title, 'button, [role="button"]')[0];
      if (trigger && available(trigger)) return trigger;
    }
    // Claude's current header uses an icon-only menu button on some account
    // variants. Its accessible name is stable even when data-testid changes.
    return candidates(document, 'button, [role="button"]').find(button => /^(?:more|more options|chat options|conversation options|open (?:chat|conversation) menu)$/i.test(button.getAttribute('aria-label') ?? ''));
  }
  return undefined;
}
const deleteLabel = (element: HTMLElement) => /^delete(?: (?:chat|conversation))?[.…]*$/i.test((element.getAttribute('aria-label') || element.textContent || '').trim());
const menuItem = (scope: ParentNode) => candidates(scope, '[role="menuitem"], button, [role="button"]').find(deleteLabel);
const menuWithDelete = () => candidates(document, '[role="menu"], [data-radix-menu-content], [data-radix-popper-content-wrapper]').find(menu => Boolean(menuItem(menu)));
const dialogWithDelete = () => candidates(document, '[role="dialog"], [role="alertdialog"], [data-radix-alert-dialog-content], [data-radix-dialog-content]').find(dialog => /delete/i.test(dialog.textContent ?? '') && Boolean(candidates(dialog, 'button').find(deleteLabel)));
function hover(element: HTMLElement) {
  for (let node: HTMLElement | null = element; node && node !== document.body; node = node.parentElement) {
    node.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    node.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false, pointerType: 'mouse', isPrimary: true }));
  }
}

export async function deleteChat(id: string, timeout = 15_000): Promise<DeleteResult> {
  let confirmed = false;
  const provider = providerForUrl(location.href);
  const name = provider ? providerLabel(provider) : 'The site';
  const assertTarget = () => {
    if (!provider || providerForUrl(location.href) !== provider || conversationIdFromUrl(location.href) !== id) throw new Error('The selected chat changed. No further delete action was taken.');
  };
  async function wait<T>(find: () => T | undefined, error: string, checkTarget = true): Promise<T> {
    const end = Date.now() + timeout;
    do {
      if (checkTarget) assertTarget();
      const value = find();
      if (value) return value;
      await pause();
    } while (Date.now() < end);
    throw new Error(error);
  }
  try {
    assertTarget();
    if (provider === 'claude') return deleteClaudeConversation(id);
    if (candidates(document, '[role="menu"], [role="dialog"], [role="alertdialog"], [data-radix-menu-content], [data-radix-alert-dialog-content]').length) throw new Error('Close the open menu or dialog before deleting this chat.');
    const trigger = await wait(() => findTrigger(id, false), `${name}'s selected chat menu could not be found. No chat was deleted.`);
    // Radix-style menus open on pointerdown, not on a synthetic click alone.
    trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse', isPrimary: true }));
    trigger.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse', isPrimary: true }));
    await pause();
    if (!candidates(document, '[role="menu"]').length && trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
    const menu = await wait(menuWithDelete, `${name}'s Delete menu item did not appear.`);
    const item = menuItem(menu)!;
    assertTarget();
    item.click();
    const dialog = await wait(dialogWithDelete, `${name}'s delete confirmation did not appear.`);
    const confirm = candidates(dialog, 'button').find(deleteLabel)!;
    assertTarget();
    confirmed = true;
    confirm.click();
    // A closing/re-rendered dialog alone is NOT proof of deletion. Wait for
    // navigation away from the selected chat AND its removal from history.
    await wait(() => providerForUrl(location.href) === provider && isNewChatUrl(location.href) && exactChatLinks(id).length === 0 && !available(dialog) ? true : undefined,
      `${name} has not confirmed the chat was removed. Check it on the site before retrying.`, false);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unable to delete this chat.', uncertain: confirmed };
  }
}
