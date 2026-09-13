import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Response } from '../shared/messages';
import type { LockState } from '../shared/types';
import logoUrl from '../assets/lockgpt-logo.svg';
import './popup.css';
import './popup-overrides.css';

const request = (message: object) => chrome.runtime.sendMessage(message) as Promise<Response>;
type ReviewChat = { id: string; cleanupStatus: string };
function App() {
  const [state, setState] = useState<LockState>(); const [pin, setPin] = useState(''); const [confirm, setConfirm] = useState(''); const [error, setError] = useState(''); const [chats, setChats] = useState<ReviewChat[]>([]); const [selected, setSelected] = useState<string[]>([]);
  const refresh = () => request({ type: 'GET_STATE' }).then(result => result.ok && setState(result.state));
  const loadChats = () => request({ type: 'GET_GUEST_CHATS' }).then(result => { if (result.ok) { const next = ((result.chats ?? []) as ReviewChat[]).filter(chat => chat.cleanupStatus !== 'deleted'); setChats(next); setSelected(next.map(chat => chat.id)); } });
  useEffect(() => { refresh(); }, []);
  async function submit(action: 'SET_PIN' | 'UNLOCK') { setError(''); if (action === 'SET_PIN' && pin !== confirm) return setError('PINs do not match.'); const result = await request({ type: action, pin }); if (!result.ok) return setError(result.error); setPin(''); setConfirm(''); setState(result.state); if (action === 'UNLOCK') loadChats(); }
  async function lock() { const result = await request({ type: 'LOCK' }); if (!result.ok) setError(result.error); else setState(result.state); }
  async function review(action: 'KEEP_GUEST_CHATS' | 'DELETE_GUEST_CHATS') { setError(''); const result = await request({ type: action, ids: selected }); if (!result.ok) setError(result.error); else if (result.state) setState(result.state); await loadChats(); }
  if (!state) return <main>Loading…</main>;
  const reviewUi = chats.length > 0 && <section className="review"><p>Select chats to keep or delete.</p>{chats.map((chat, i) => <label key={chat.id} className="chat-row"><input type="checkbox" checked={selected.includes(chat.id)} disabled={chat.cleanupStatus === 'deleted'} onChange={e => setSelected(e.target.checked ? [...selected, chat.id] : selected.filter(id => id !== chat.id))} />Guest chat {i + 1} <small>{chat.cleanupStatus}</small></label>)}<button className="secondary" onClick={() => review('KEEP_GUEST_CHATS')}>Keep selected</button><button className="danger" onClick={() => review('DELETE_GUEST_CHATS')}>Delete selected</button></section>;
  return <main><header><img className="brand-mark" src={logoUrl} alt="LockGPT" /><div><h1>LockGPT</h1><p className="eyebrow">HIDE YOUR AI CHATS</p></div></header>
    {state.phase === 'UNCONFIGURED' ? <><p>Hide your existing ChatGPT conversations while someone borrows your browser.</p><label>New PIN<input aria-label="New PIN" inputMode="numeric" type="password" value={pin} onChange={e => setPin(e.target.value)} /></label><label>Confirm PIN<input aria-label="Confirm PIN" inputMode="numeric" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} /></label><button onClick={() => submit('SET_PIN')}>Create PIN</button></> : (state.phase === 'LOCKED' || state.phase === 'LOCKING') ? <><p>Existing conversations are hidden. Guest chats may remain in this account.</p><label>PIN<input aria-label="PIN" autoFocus inputMode="numeric" type="password" value={pin} onChange={e => setPin(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit('UNLOCK')} /></label><button onClick={() => submit('UNLOCK')}>Unlock</button></> : <><p>LockGPT protects all ChatGPT tabs in this browser profile.</p><button onClick={lock}>Lock &amp; start guest session</button>{state.lastGuestSessionId && <><button className="secondary" onClick={loadChats}>Review last guest session</button>{reviewUi}</>}</>}
    {error && <p role="alert" className="error">{error}</p>}</main>;
}
createRoot(document.getElementById('root')!).render(<App />);
