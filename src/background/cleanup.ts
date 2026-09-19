import { getChats, getState, saveChats } from '../shared/storage';
import type { Provider } from '../shared/types';
import type { Response } from '../shared/messages';
import type { DeleteResult } from '../content/delete-chat';

const pause = () => new Promise(resolve => setTimeout(resolve, 200));
async function waitForCleanupScript(tabId: number) {
  const end = Date.now() + 20_000;
  while (Date.now() < end) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') {
      try {
        const ready = await chrome.tabs.sendMessage(tabId, { type: 'CLEANUP_READY' });
        if (ready?.ok) return;
      } catch { /* The dynamically imported content script may still be loading. */ }
    }
    await pause();
  }
  throw new Error('The chat page did not finish loading. Refresh the site and try again.');
}

// Called under the state controller's mutation queue. Read-only state requests
// must remain available while the dedicated cleanup tab starts up.
export async function deleteChats(ids: string[], provider?: Provider): Promise<Response> {
  const state = await getState();
  const sessionId = state.guestSessionId ?? state.lastGuestSessionId;
  if (!['UNLOCKED', 'LOCKED'].includes(state.phase) || !sessionId || !Array.isArray(ids) || !ids.length) return { ok: false, error: 'Select guest chats from the current session.', state };
  const chats = await getChats();
  const selected = chats.filter(chat => chat.sessionId === sessionId && ids.includes(chat.id) && chat.cleanupStatus !== 'deleted' && (!provider || chat.provider === provider));
  if (!selected.length) return { ok: false, error: 'No matching guest chats are available.', state };
  for (const chat of selected) {
    // An interrupted confirmation is never retried blindly.
    if (chat.cleanupStatus === 'unknown') continue;
    let tabId: number | undefined;
    let dispatched = false;
    try {
      if (!/^[a-zA-Z0-9-]+$/.test(chat.id) || chat.confidence !== 'verified') throw new Error('This chat could not be verified for deletion.');
      const url = chat.provider === 'claude' ? `https://claude.ai/chat/${chat.id}` : `https://chatgpt.com/c/${chat.id}`;
      const tab = await chrome.tabs.create({ url, active: false });
      if (tab.id === undefined) throw new Error('Unable to open the selected guest chat.');
      tabId = tab.id;
      await waitForCleanupScript(tabId);
      chat.cleanupStatus = 'unknown';
      chat.cleanupError = 'Deletion was interrupted. Check this chat on the site before retrying.';
      await saveChats(chats);
      dispatched = true;
      // Never retry this message: it can already have reached confirmation.
      const result = await chrome.tabs.sendMessage(tabId, { type: 'DELETE_CURRENT_GUEST_CHAT', id: chat.id }) as DeleteResult | undefined;
      if (!result || typeof result.ok !== 'boolean') throw new Error('The cleanup tab disconnected. Check the chat on the site.');
      chat.cleanupStatus = result.ok ? 'deleted' : result.uncertain ? 'unknown' : 'failed';
      chat.cleanupError = result.ok ? undefined : result.error;
    } catch (error) {
      chat.cleanupStatus = dispatched ? 'unknown' : 'failed';
      chat.cleanupError = error instanceof Error ? error.message : 'Unable to delete this chat.';
    } finally {
      await saveChats(chats);
      if (tabId !== undefined) await chrome.tabs.remove(tabId).catch(() => undefined);
    }
  }
  const failures = selected.filter(chat => chat.cleanupStatus !== 'deleted');
  if (failures.length) return { ok: false, state, error: `${selected.length - failures.length} of ${selected.length} chats deleted. ${failures[0].cleanupError ?? 'Check the remaining chats on the site.'}` };
  return { ok: true, chats: selected, state };
}
