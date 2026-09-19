import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Response } from '../shared/messages';
import type { LockState, Provider } from '../shared/types';
import logoUrl from '../assets/lockgpt-logo.svg';
import './popup.css';

const request = (message: object) => chrome.runtime.sendMessage(message) as Promise<Response>;
type ReviewChat = { id: string; title?: string; cleanupStatus: string; cleanupError?: string };
function App() {
  const [reviewBusy, setReviewBusy] = useState(false);
  const [state, setState] = useState<LockState>(); const [provider, setProvider] = useState<Provider>(); const [pin, setPin] = useState(''); const [confirm, setConfirm] = useState(''); const [error, setError] = useState(''); const [chats, setChats] = useState<ReviewChat[]>([]); const [selected, setSelected] = useState<string[]>([]);
  const refresh = () => request({ type: 'GET_STATE' }).then(result => result.ok && setState(result.state));
  const loadChats = () => request({ type: 'GET_GUEST_CHATS' }).then(result => { if (result.ok) { const next = ((result.chats ?? []) as ReviewChat[]).filter(chat => chat.cleanupStatus !== 'deleted'); setChats(next); setSelected(next.map(chat => chat.id)); } });
  useEffect(() => { refresh(); request({ type: 'GET_ACTIVE_PROVIDER' }).then(result => result.ok && setProvider(result.provider)); }, []);
  async function submit(action: 'SET_PIN' | 'UNLOCK') { setError(''); if (action === 'SET_PIN' && pin !== confirm) return setError('PINs do not match.'); const result = await request({ type: action, pin }); if (!result.ok) return setError(result.error); setPin(''); setConfirm(''); setState(result.state); if (action === 'UNLOCK') loadChats(); }
  async function lock() { const result = await request({ type: 'LOCK' }); if (!result.ok) setError(result.error); else setState(result.state); }
  async function review(action: 'KEEP_GUEST_CHATS' | 'DELETE_GUEST_CHATS') {
    if (reviewBusy) return;
    setReviewBusy(true); setError('');
    try {
      const result = await request({ type: action, ids: selected });
      if (!result.ok) setError(result.error);
      if (result.state) setState(result.state);
      await loadChats();
    } catch { setError('Cleanup was interrupted. Reopen this popup to check the remaining chats.'); }
    finally { setReviewBusy(false); }
  }
  if (!state) return <main>Loading…</main>;
  const reviewUi = chats.length > 0 && <section className="review"><h2>Guest chats</h2><p>Choose which chats to keep in this account.</p>{chats.map((chat, i) => <label key={chat.id} className="chat-row"><input type="checkbox" checked={selected.includes(chat.id)} disabled={reviewBusy} onChange={e => setSelected(e.target.checked ? [...selected, chat.id] : selected.filter(id => id !== chat.id))} /><span className="chat-title">{chat.title || `Guest chat ${i + 1}`}</span><small title={chat.cleanupError}>{chat.cleanupStatus === 'unknown' ? 'Check on site' : chat.cleanupStatus}</small></label>)}<button className="secondary" disabled={reviewBusy || !selected.length} onClick={() => review('KEEP_GUEST_CHATS')}>Keep selected</button><button className="danger" disabled={reviewBusy || !selected.length} onClick={() => review('DELETE_GUEST_CHATS')}>{reviewBusy ? 'Working…' : 'Delete selected'}</button></section>;
  const providerName = provider === 'claude' ? 'Claude' : provider === 'chatgpt' ? 'ChatGPT' : 'ChatGPT & Claude';
  return <main><header><span className="brand-mark"><img src={logoUrl} alt="" /></span><div><h1>LockGPT</h1><p className="eyebrow">Guest access for {providerName}</p></div></header>
    {state.phase === 'UNCONFIGURED' ? <><h2>Set up guest access</h2><p>Create a PIN to keep your {providerName} chats private when someone borrows your browser.</p><label>New PIN<input aria-label="New PIN" inputMode="numeric" type="password" value={pin} onChange={e => setPin(e.target.value)} /></label><label>Confirm PIN<input aria-label="Confirm PIN" inputMode="numeric" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} /></label><small>Use at least 6 digits.</small><button onClick={() => submit('SET_PIN')}>Create PIN</button></> : (state.phase === 'LOCKED' || state.phase === 'LOCKING') ? <><h2>Guest session is on</h2><p>Your {providerName} chats are hidden. Enter your PIN to return to your account.</p><label>PIN<input aria-label="PIN" autoFocus inputMode="numeric" type="password" value={pin} onChange={e => setPin(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit('UNLOCK')} /></label><button onClick={() => submit('UNLOCK')}>Unlock</button></> : <><h2>Share a fresh chat</h2><p>Hide your existing {providerName} conversations while a guest uses your browser.</p><button onClick={lock}>Lock &amp; start guest session</button>{state.lastGuestSessionId && <><button className="secondary" onClick={loadChats}>Review last guest session</button>{reviewUi}</>}</>}
    {error && <p role="alert" className="error">{error}</p>}</main>;
}
createRoot(document.getElementById('root')!).render(<App />);
