// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://chatgpt.com/c/guest"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteChat, deleteClaudeConversation } from '../../src/content/delete-chat';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('PointerEvent', MouseEvent);
  history.replaceState({}, '', '/c/guest');
  document.body.innerHTML = '';
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function fixture(options: { pointer?: boolean; delay?: number; success?: boolean; row?: boolean } = {}) {
  document.body.innerHTML = options.row
    ? '<nav><div><a href="/c/owner">Owner</a><button aria-haspopup="menu" id="owner">More</button></div><div><a href="/c/guest">Guest</a><button aria-haspopup="menu" id="trigger">More</button></div></nav>'
    : '<div data-testid="chat-title-split"><button aria-haspopup="menu" id="trigger">Guest title</button></div><a href="/c/guest" id="history-link">Guest</a>';
  const owner = vi.fn();
  document.querySelector('#owner')?.addEventListener('click', owner);
  document.querySelector('#owner')?.addEventListener('pointerdown', owner);
  const confirmClick = vi.fn();
  const open = vi.fn(() => {
    if (document.querySelector('[role="menu"]')) return;
    const menu = document.createElement('div'); menu.setAttribute('role', 'menu');
    menu.innerHTML = '<div role="menuitem">Delete</div>';
    menu.firstElementChild!.addEventListener('click', () => {
      menu.remove();
      const dialog = document.createElement('div'); dialog.setAttribute('role', 'alertdialog');
      dialog.innerHTML = '<h2>Delete conversation?</h2><button>Cancel</button><button id="confirm">Delete</button>';
      dialog.querySelector('#confirm')!.addEventListener('click', () => {
        confirmClick();
        setTimeout(() => {
          dialog.remove();
          if (options.success !== false) {
            document.querySelectorAll('a[href="/c/guest"]').forEach(link => link.remove());
            history.pushState({}, '', '/');
          }
        }, options.delay ?? 1_200);
      });
      document.body.append(dialog);
    });
    document.body.append(menu);
  });
  document.querySelector('#trigger')!.addEventListener(options.pointer ? 'pointerdown' : 'click', open);
  return { owner, open, confirmClick };
}

describe('conversation deletion UI', () => {
  it('uses Claude’s conversation endpoint for the exact chat instead of its title menu', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ uuid: 'personal-org' }, { uuid: 'other-org' }]), { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', request);
    expect(await deleteClaudeConversation('guest')).toEqual({ ok: true });
    expect(request).toHaveBeenNthCalledWith(1, '/api/organizations', expect.objectContaining({ credentials: 'include' }));
    expect(request).toHaveBeenNthCalledWith(2, '/api/organizations/personal-org/chat_conversations/guest', expect.objectContaining({ method: 'DELETE' }));
    expect(request).toHaveBeenNthCalledWith(3, '/api/organizations/other-org/chat_conversations/guest', expect.objectContaining({ method: 'DELETE' }));
  });
  it('reports a Claude endpoint failure without clicking the UI menu', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ uuid: 'personal-org' }]), { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 500 })));
    const result = await deleteClaudeConversation('guest');
    expect(result).toMatchObject({ ok: false, error: 'Claude did not delete this chat (500).' });
  });
  it('opens a nested Claude title trigger on pointerdown and waits beyond 500ms for removal', async () => {
    const { confirmClick } = fixture({ pointer: true });
    let done = false;
    const result = deleteChat('guest', 2_000).then(r => { done = true; return r; });
    await vi.advanceTimersByTimeAsync(600);
    expect(confirmClick).toHaveBeenCalledTimes(1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(await result).toEqual({ ok: true });
  });
  it('supports a click-driven menu and targets only the requested sidebar row', async () => {
    const { owner, open } = fixture({ row: true });
    const result = deleteChat('guest', 2_000);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await result).toEqual({ ok: true });
    expect(owner).not.toHaveBeenCalled(); expect(open).toHaveBeenCalledTimes(1);
  });
  it('supports Claude header controls that use an accessible menu name instead of a test id', async () => {
    document.body.innerHTML = '<a href="/c/guest">Guest</a><button aria-haspopup="menu" aria-label="Open chat menu" id="trigger">•••</button>';
    const trigger = document.querySelector<HTMLButtonElement>('#trigger')!;
    trigger.addEventListener('click', () => {
      const menu = document.createElement('div'); menu.setAttribute('data-radix-menu-content', '');
      menu.innerHTML = '<button>Delete conversation</button>';
      menu.firstElementChild!.addEventListener('click', () => {
        menu.remove(); const dialog = document.createElement('div'); dialog.setAttribute('data-radix-alert-dialog-content', '');
        dialog.innerHTML = '<p>Delete this conversation?</p><button>Delete</button>';
        dialog.querySelector('button')!.addEventListener('click', () => { dialog.remove(); document.querySelector('a')!.remove(); history.pushState({}, '', '/'); });
        document.body.append(dialog);
      });
      document.body.append(menu);
    });
    const result = deleteChat('guest', 2_000); await vi.advanceTimersByTimeAsync(2_500);
    expect(await result).toEqual({ ok: true });
  });
  it('does not call a disappearing dialog success without route/history evidence', async () => {
    fixture({ success: false });
    const result = deleteChat('guest', 2_000);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await result).toMatchObject({ ok: false, uncertain: true });
  });
  it('rejects a different conversation before opening its menu', async () => {
    const { open } = fixture();
    expect(await deleteChat('owner')).toMatchObject({ ok: false, uncertain: false });
    expect(open).not.toHaveBeenCalled();
  });
  it('never clicks global delete buttons or pre-existing confirmation dialogs', async () => {
    const { open } = fixture();
    const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog');
    dialog.innerHTML = '<button data-testid="delete-all">Delete all chats</button>';
    document.body.append(dialog);
    expect(await deleteChat('guest')).toMatchObject({ ok: false, uncertain: false });
    expect(open).not.toHaveBeenCalled();
  });
  it('does not fall back to a delete control outside the opened menu', async () => {
    document.body.innerHTML = '<button data-testid="chat-menu-trigger">Guest</button><button data-testid="delete-all">Delete</button>';
    const globalDelete = vi.fn(); document.querySelector('[data-testid="delete-all"]')!.addEventListener('click', globalDelete);
    document.querySelector('[data-testid="chat-menu-trigger"]')!.addEventListener('click', () => {
      const menu = document.createElement('div'); menu.setAttribute('role', 'menu'); menu.innerHTML = '<div role="menuitem">Delete all chats</div>'; document.body.append(menu);
    });
    const result = deleteChat('guest', 500); await vi.advanceTimersByTimeAsync(1_000);
    expect(await result).toMatchObject({ ok: false, uncertain: false });
    expect(globalDelete).not.toHaveBeenCalled();
  });
  it('waits for a late menu trigger to mount', async () => {
    setTimeout(() => fixture(), 800);
    const result = deleteChat('guest', 2_000); await vi.advanceTimersByTimeAsync(3_000);
    expect(await result).toEqual({ ok: true });
  });
  it('stops before confirming if navigation switches to a different chat', async () => {
    const { confirmClick } = fixture();
    document.querySelector('#trigger')!.addEventListener('click', () => {
      document.querySelector('[role="menuitem"]')!.addEventListener('click', () => history.pushState({}, '', '/c/owner'));
    });
    const result = deleteChat('guest', 500);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await result).toMatchObject({ ok: false, uncertain: false });
    expect(confirmClick).not.toHaveBeenCalled();
  });
});
