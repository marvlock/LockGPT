// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuestConversation, LockState } from '../../src/shared/types';
import type { Request, Response } from '../../src/shared/messages';

const locked: LockState = { phase: 'LOCKED', revision: 2, guestSessionId: 'session' };
let chats: GuestConversation[];
let currentState: LockState;
let registration: (result: Response) => void;
let notify: (message: { type: string; state?: LockState }) => void;
let sendMessage: ReturnType<typeof vi.fn>;
let observers: MutationObserver[];
let listeners: Array<[string, EventListenerOrEventListenerObject, boolean | AddEventListenerOptions | undefined]>;
let windowListeners: typeof listeners;

const settle = () => vi.advanceTimersByTimeAsync(0);
const navigate = (path: string) => { history.pushState({}, '', path); notify({ type: 'CHECK_ROUTE' }); };
const submit = () => {
  const composer = document.querySelector('textarea')!;
  composer.value = 'Plan a weekend trip';
  composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
};
const recordChat = () => {
  chats.push({ id: 'guest', title: 'Plan a weekend trip', provider: 'chatgpt', sessionId: 'session', tabId: 1, createdAt: 0, evidence: 'submission-route', confidence: 'verified', cleanupStatus: 'unreviewed' });
  registration({ ok: true, state: locked });
};

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  chats = [];
  currentState = locked;
  observers = [];
  listeners = [];
  windowListeners = [];
  history.replaceState({}, '', '/');
  document.documentElement.className = '';
  document.querySelector('#lockgpt-root')?.remove();
  document.body.innerHTML = '<form><textarea></textarea><button type="submit">Send</button></form>';
  const NativeObserver = MutationObserver;
  vi.stubGlobal('MutationObserver', class extends NativeObserver {
    constructor(callback: MutationCallback) { super(callback); observers.push(this); }
  });
  const addListener = document.addEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
    listeners.push([type, listener, options]);
    addListener(type, listener, options);
  });
  const addWindowListener = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
    windowListeners.push([type, listener, options]);
    addWindowListener(type, listener, options);
  });
  sendMessage = vi.fn(async (message: Request): Promise<Response> => {
    if (message.type === 'GET_STATE') return { ok: true, state: currentState };
    if (message.type === 'GET_GUEST_CHATS') return { ok: true, chats: [...chats] };
    if (message.type === 'TRACK_GUEST_CHAT') return new Promise(resolve => { registration = resolve; });
    throw new Error(`Unexpected request: ${message.type}`);
  });
  vi.stubGlobal('chrome', { runtime: { sendMessage, onMessage: { addListener: (listener: typeof notify) => { notify = listener; } } } });
  await import('../../src/content/bootstrap');
  await settle();
  expect(document.querySelector('.lockgpt-panel')).not.toBeNull();
});

afterEach(() => {
  observers.forEach(observer => observer.disconnect());
  listeners.forEach(([type, listener, options]) => document.removeEventListener(type, listener, options));
  windowListeners.forEach(([type, listener, options]) => window.removeEventListener(type, listener, options));
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('settings protection', () => {
  it('hides settings and profile controls and intercepts their mouse and keyboard events', async () => {
    const container = document.createElement('div');
    container.innerHTML = '<button data-testid="accounts-profile-button"><span>Profile</span></button><button aria-label="Open settings">Settings</button>';
    document.body.append(container);
    const buttons = [...container.querySelectorAll('button')];
    const handlers = buttons.map(button => {
      const handler = vi.fn();
      for (const type of ['pointerdown', 'click', 'keydown']) button.addEventListener(type, handler);
      return handler;
    });
    for (const button of buttons) {
      expect(button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))).toBe(false);
      expect(button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))).toBe(false);
      expect(button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))).toBe(false);
    }
    await settle();
    expect(handlers.every(handler => handler.mock.calls.length === 0)).toBe(true);
    expect(buttons.every(button => button.hasAttribute('data-lockgpt-settings-blocked'))).toBe(true);
    expect(document.querySelector('.lockgpt-cover')).toBeNull();
  });

  it('blocks direct settings hashes immediately, even on the approved new-chat route', async () => {
    history.pushState({}, '', '/#settings/General');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(document.documentElement.classList.contains('lockgpt-pending')).toBe(true);
    await vi.advanceTimersByTimeAsync(400);
    expect(document.querySelector('.lockgpt-card h1')?.textContent).toBe('Settings are locked during guest mode');
    history.replaceState({}, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await settle();
    expect(document.querySelector('.lockgpt-cover')).toBeNull();
  });

  it('blocks settings on a recorded guest conversation without registering a settings route', async () => {
    submit();
    navigate('/c/guest');
    await vi.advanceTimersByTimeAsync(150);
    recordChat();
    await settle();
    navigate('/c/guest#settings');
    expect(document.documentElement.classList.contains('lockgpt-pending')).toBe(true);
    await vi.advanceTimersByTimeAsync(400);
    expect(document.querySelector('.lockgpt-card h1')?.textContent).toBe('Settings are locked during guest mode');
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'TRACK_GUEST_CHAT')).toHaveLength(1);
  });

  it('covers a settings dialog opened without a URL change', async () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-labelledby', 'settings-title');
    dialog.innerHTML = '<h2 id="settings-title">Settings</h2><button>Delete account</button>';
    document.body.append(dialog);
    await settle();
    expect(document.documentElement.classList.contains('lockgpt-pending')).toBe(true);
    await vi.advanceTimersByTimeAsync(400);
    expect(document.querySelector('.lockgpt-card h1')?.textContent).toBe('Settings are locked during guest mode');
  });

  it('blocks newly inserted settings menu items before the observer runs', () => {
    const item = document.createElement('div');
    item.setAttribute('role', 'menuitem');
    item.innerHTML = '<span>Settings</span>';
    const openSettings = vi.fn();
    item.addEventListener('click', openSettings);
    document.body.append(item);
    item.querySelector('span')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(openSettings).not.toHaveBeenCalled();
  });

  it('leaves the composer and unrelated dialogs usable', async () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.innerHTML = '<h2>Attach a file</h2><button>Browse files</button>';
    document.body.append(dialog);
    await vi.advanceTimersByTimeAsync(150);
    expect(document.querySelector('.lockgpt-cover')).toBeNull();
    const clicked = vi.fn();
    dialog.querySelector('button')!.addEventListener('click', clicked);
    dialog.querySelector('button')!.click();
    expect(clicked).toHaveBeenCalledOnce();
    submit();
    navigate('/c/guest');
    await vi.advanceTimersByTimeAsync(150);
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'TRACK_GUEST_CHAT')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(document.querySelector('.lockgpt-cover')).toBeNull();
    recordChat();
    await settle();
  });

  it('restores settings controls and direct settings URLs after unlock', async () => {
    const button = document.createElement('button');
    button.textContent = 'Settings';
    document.body.append(button);
    await settle();
    expect(button.hasAttribute('data-lockgpt-settings-blocked')).toBe(true);
    currentState = { phase: 'UNLOCKED', revision: 3 };
    notify({ type: 'STATE_CHANGED', state: currentState });
    await settle();
    expect(button.hasAttribute('data-lockgpt-settings-blocked')).toBe(false);
    const openSettings = vi.fn();
    button.addEventListener('click', openSettings);
    button.click();
    expect(openSettings).toHaveBeenCalledOnce();
    navigate('/#settings');
    await vi.advanceTimersByTimeAsync(400);
    expect(document.querySelector('.lockgpt-cover')).toBeNull();
    expect(document.documentElement.classList.contains('lockgpt-pending')).toBe(false);
  });
});

describe('guest chat submission transitions', () => {
  it('registers a Send-button click even when the composer does not submit a form', async () => {
    document.body.innerHTML = '<div><div id="prompt-textarea" contenteditable="true"><p>Plan a weekend trip</p></div><button data-testid="send-button" type="button"><span>Send</span></button></div>';
    const button = document.querySelector<HTMLButtonElement>('[data-testid="send-button"]')!;
    button.addEventListener('click', () => {
      document.querySelector('#prompt-textarea')!.textContent = '';
      navigate('/c/guest');
    });
    button.querySelector('span')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(150);
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'TRACK_GUEST_CHAT')).toHaveLength(1);
    recordChat();
    await settle();
    expect(document.querySelector('.lockgpt-cover')).toBeNull();
  });

  it('does not cover a recorded guest chat while its composer is mounting', async () => {
    chats.push({ id: 'guest', title: 'Existing guest chat', sessionId: 'session', tabId: 1, createdAt: 0, evidence: 'submission-route', confidence: 'verified', cleanupStatus: 'unreviewed' });
    document.querySelector('textarea')!.remove();
    const addClass = vi.spyOn(document.documentElement.classList, 'add');
    navigate('/c/guest');
    await vi.advanceTimersByTimeAsync(500);
    expect(document.querySelector('.lockgpt-cover')).toBeNull();
    expect(addClass.mock.calls.some(args => args.includes('lockgpt-pending'))).toBe(false);
  });

  it('does not treat a disabled Send button as a submission', async () => {
    document.body.innerHTML = '<div id="prompt-textarea" contenteditable="true">A draft</div><button data-testid="send-button" disabled>Send</button>';
    document.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    navigate('/c/owner');
    await vi.advanceTimersByTimeAsync(500);
    expect(sendMessage.mock.calls.some(([message]) => message.type === 'TRACK_GUEST_CHAT')).toBe(false);
    expect(document.querySelector('.lockgpt-cover')).not.toBeNull();
  });

  it('still blocks an unknown chat when its composer is absent', async () => {
    document.querySelector('textarea')!.remove();
    navigate('/c/owner');
    await vi.advanceTimersByTimeAsync(500);
    expect(document.querySelector('.lockgpt-card h1')?.textContent).toBe('This conversation is private');
  });

  it('waits for registration across overlapping route and DOM checks without flashing a cover', async () => {
    const addClass = vi.spyOn(document.documentElement.classList, 'add');
    submit();
    navigate('/c/guest');
    document.body.append(document.createElement('div'));
    await vi.advanceTimersByTimeAsync(150);
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'TRACK_GUEST_CHAT')).toHaveLength(1);
    expect(document.querySelector('.lockgpt-cover')).toBeNull();
    recordChat();
    await settle();
    expect(document.querySelector('[aria-current="page"]')?.textContent).toBe('Plan a weekend trip');
    expect(addClass.mock.calls.some(args => args.includes('lockgpt-pending'))).toBe(false);
  });

  it('blocks an unknown conversation without a guest submission', async () => {
    navigate('/c/owner');
    await vi.advanceTimersByTimeAsync(150);
    expect(document.querySelector('.lockgpt-cover')).not.toBeNull();
    expect(sendMessage.mock.calls.some(([message]) => message.type === 'TRACK_GUEST_CHAT')).toBe(false);
  });

  it('keeps the page covered when registration fails', async () => {
    submit();
    navigate('/c/guest');
    await vi.advanceTimersByTimeAsync(150);
    registration({ ok: false, error: 'Stale guest record.' });
    await settle();
    expect(document.querySelector('.lockgpt-cover')).not.toBeNull();
  });

  it('does not let a late registration reveal a different conversation', async () => {
    submit();
    navigate('/c/guest');
    await vi.advanceTimersByTimeAsync(150);
    navigate('/c/owner');
    await vi.advanceTimersByTimeAsync(150);
    expect(document.querySelector('.lockgpt-cover')).not.toBeNull();
    recordChat();
    await settle();
    expect(document.querySelector('.lockgpt-cover')).not.toBeNull();
    expect(document.documentElement.classList.contains('lockgpt-pending')).toBe(true);
  });

  it('keeps an approved submission visible while ChatGPT remounts its composer', async () => {
    submit();
    navigate('/c/guest');
    document.querySelector('textarea')!.remove();
    await vi.advanceTimersByTimeAsync(150);
    recordChat();
    await settle();
    expect(document.querySelector('.lockgpt-cover')).toBeNull();
    expect(document.querySelector('[aria-current="page"]')).not.toBeNull();
    document.body.append(document.createElement('div'));
    await vi.advanceTimersByTimeAsync(150);
    expect(document.querySelector('.lockgpt-cover')).toBeNull();
  });

  it('does not flash when URL metadata changes while an approved composer remounts', async () => {
    submit();
    navigate('/c/guest');
    await vi.advanceTimersByTimeAsync(150);
    recordChat();
    await settle();
    const addClass = vi.spyOn(document.documentElement.classList, 'add');
    document.querySelector('textarea')!.remove();
    navigate('/c/guest/?model=auto#latest');
    await vi.advanceTimersByTimeAsync(150);
    expect(document.querySelector('.lockgpt-cover')).toBeNull();
    expect(addClass.mock.calls.some(args => args.includes('lockgpt-pending'))).toBe(false);
  });

  it('does not interpret Enter outside the composer as a guest submission', async () => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    navigate('/c/owner');
    await vi.advanceTimersByTimeAsync(150);
    expect(document.querySelector('.lockgpt-cover')).not.toBeNull();
    expect(sendMessage.mock.calls.some(([message]) => message.type === 'TRACK_GUEST_CHAT')).toBe(false);
  });

  it('blocks private content immediately but cancels a brief warning when a safe route returns', async () => {
    navigate('/c/owner');
    await vi.advanceTimersByTimeAsync(100);
    expect(document.documentElement.classList.contains('lockgpt-pending')).toBe(true);
    expect(document.querySelector('.lockgpt-cover')).not.toBeNull();
    expect(document.querySelector('.lockgpt-card')).toBeNull();
    navigate('/');
    await vi.advanceTimersByTimeAsync(500);
    expect(document.querySelector('.lockgpt-cover')).toBeNull();
    expect(document.querySelector('.lockgpt-panel')).not.toBeNull();
  });

  it('shows a persistent private warning without restarting its timer on DOM changes', async () => {
    navigate('/c/owner');
    await vi.advanceTimersByTimeAsync(100);
    for (let i = 0; i < 4; i++) {
      document.body.append(document.createElement('div'));
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(document.querySelector('.lockgpt-card h1')?.textContent).toBe('This conversation is private');
    expect(document.documentElement.classList.contains('lockgpt-pending')).toBe(true);
  });

  it('does not label a verification failure as a private conversation', async () => {
    submit();
    navigate('/c/guest');
    await vi.advanceTimersByTimeAsync(150);
    registration({ ok: false, error: 'Unable to register chat.' });
    await vi.advanceTimersByTimeAsync(350);
    expect(document.querySelector('.lockgpt-card h1')?.textContent).toBe('Guest mode is temporarily unavailable');
    expect(document.documentElement.classList.contains('lockgpt-pending')).toBe(true);
  });

  it('cancels the delayed warning when the owner unlocks', async () => {
    navigate('/c/owner');
    await vi.advanceTimersByTimeAsync(100);
    currentState = { phase: 'UNLOCKED', revision: 3 };
    notify({ type: 'STATE_CHANGED', state: currentState });
    await vi.advanceTimersByTimeAsync(500);
    expect(document.querySelector('#lockgpt-root')?.childElementCount).toBe(0);
    expect(document.documentElement.classList.contains('lockgpt-pending')).toBe(false);
  });

  it('does not let an earlier check repaint the guest sidebar after unlock', async () => {
    submit();
    navigate('/c/guest');
    await vi.advanceTimersByTimeAsync(150);
    currentState = { phase: 'UNLOCKED', revision: 3 };
    notify({ type: 'STATE_CHANGED', state: currentState });
    await settle();
    recordChat();
    await settle();
    expect(document.querySelector('#lockgpt-root')?.childElementCount).toBe(0);
    expect(document.documentElement.classList.contains('lockgpt-guest')).toBe(false);
  });
});
