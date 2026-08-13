import React, { useEffect, useMemo, useRef, useState } from 'react';
import packageInfo from '../package.json';
import {
  GROUPS,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEP,
  bettorsOnPair,
  calculateSettlement,
  clampZoom,
  cutoffReached,
  currency,
  downloadText,
  effectiveBettingOpen,
  makeDefaultState,
  migrateState,
  nextPairNumber,
  pairMultiplier,
  pairName,
  pct,
  playerInitials,
  prizePool,
  projectedBet,
  resizeProfilePhoto,
  safePhotoSrc,
  settlementCsv,
  totalOnPair,
  totalPool
} from './lib/pool.js';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import {
  archiveEvent,
  auth,
  deleteProfilePhoto,
  firebaseMissingKeys,
  firebaseReady,
  isAdminUser,
  listenPublicDashboard,
  loadAdminState,
  loadEventArchives,
  migrateInlinePhotosToStorage,
  saveAdminState,
  uploadProfilePhoto
} from './lib/firebase.js';

function publicProjectedPayout(data, pair, amount = 5) {
  const wager = Number(amount || 0);
  if (wager <= 0) return null;

  const currentPool = Number(data?.totalPool || 0);
  const currentPairTotal = Number(pair?.betTotal || 0);
  const feePercent = Math.min(100, Math.max(0, Number(data?.feePercent || 0)));
  const nextTotalPool = currentPool + wager;
  const nextPairTotal = currentPairTotal + wager;
  if (nextTotalPool <= 0 || nextPairTotal <= 0) return null;

  const nextPrizePool = nextTotalPool * (1 - feePercent / 100);
  const payout = nextPrizePool * (wager / nextPairTotal);
  return Number.isFinite(payout) ? payout : null;
}

function sanitizeEventDescriptionHtml(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (typeof DOMParser === 'undefined') return raw.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  const parser = new DOMParser();
  const documentValue = parser.parseFromString(`<div>${raw}</div>`, 'text/html');
  const root = documentValue.body.firstElementChild;
  const allowed = new Set(['P','BR','STRONG','B','EM','I','U','UL','OL','LI','A','DIV']);
  const elements = Array.from(root.querySelectorAll('*'));
  elements.forEach(element => {
    const tag = element.tagName;
    if (!allowed.has(tag)) {
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'IFRAME' || tag === 'OBJECT') {
        element.remove();
        return;
      }
      element.replaceWith(...Array.from(element.childNodes));
      return;
    }
    const href = tag === 'A' ? element.getAttribute('href') : null;
    Array.from(element.attributes).forEach(attribute => element.removeAttribute(attribute.name));
    if (tag === 'A' && href && /^(https?:|mailto:|tel:)/i.test(href.trim())) {
      element.setAttribute('href', href.trim());
      element.setAttribute('target', '_blank');
      element.setAttribute('rel', 'noopener noreferrer');
    }
  });
  return root.innerHTML;
}

function toLocalDateTimeInputValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = number => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalDateTimeInputValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatRemainingTime(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const pad = value => String(value).padStart(2, '0');
  return days > 0 ? `${days}d ${pad(hours)}:${pad(minutes)}:${pad(secs)}` : `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
}

function CutoffCountdown({ cutoffAt }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!cutoffAt) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [cutoffAt]);
  if (!cutoffAt) return null;
  const cutoff = new Date(cutoffAt);
  if (Number.isNaN(cutoff.getTime())) return null;
  const remaining = cutoff.getTime() - now;
  return <span className={`cutoff-countdown ${remaining <= 0 ? 'expired' : ''}`} title={`Betting cutoff: ${cutoff.toLocaleString()}`}>{remaining <= 0 ? 'BETTING ENDED' : `ENDS IN ${formatRemainingTime(remaining)}`}</span>;
}

function EventDescription({ html, className = '' }) {
  const safeHtml = useMemo(() => sanitizeEventDescriptionHtml(html), [html]);
  if (!safeHtml) return null;
  return <div className={`event-description ${className}`.trim()} dangerouslySetInnerHTML={{ __html: safeHtml }} />;
}

function RichTextEditor({ value, onChange }) {
  const editorRef = useRef(null);
  const editingRef = useRef(false);
  const draftRef = useRef(String(value || ''));

  useEffect(() => {
    const nextValue = String(value || '');
    draftRef.current = nextValue;
    // Never rewrite the contentEditable DOM while the user is typing. Replacing
    // innerHTML while focused can reset the caret / virtual keyboard on mobile.
    if (!editingRef.current && editorRef.current && editorRef.current.innerHTML !== nextValue) {
      editorRef.current.innerHTML = nextValue;
    }
  }, [value]);

  const captureDraft = () => {
    draftRef.current = editorRef.current?.innerHTML || '';
  };
  const commit = () => {
    captureDraft();
    const clean = sanitizeEventDescriptionHtml(draftRef.current);
    draftRef.current = clean;
    onChange(clean);
  };
  const command = (name, argument = null) => {
    editorRef.current?.focus();
    document.execCommand(name, false, argument);
    captureDraft();
  };
  const addLink = () => {
    const href = window.prompt('Enter the link URL (https://, mailto:, or tel:):', 'https://');
    if (!href) return;
    if (!/^(https?:|mailto:|tel:)/i.test(href.trim())) return;
    command('createLink', href.trim());
  };

  return <div className="rich-editor">
    <div className="rich-editor-toolbar" aria-label="Event description formatting">
      <button type="button" onMouseDown={event => { event.preventDefault(); command('bold'); }} title="Bold"><strong>B</strong></button>
      <button type="button" onMouseDown={event => { event.preventDefault(); command('italic'); }} title="Italic"><em>I</em></button>
      <button type="button" onMouseDown={event => { event.preventDefault(); command('underline'); }} title="Underline"><u>U</u></button>
      <button type="button" onMouseDown={event => { event.preventDefault(); command('insertUnorderedList'); }} title="Bulleted list">• List</button>
      <button type="button" onMouseDown={event => { event.preventDefault(); command('insertOrderedList'); }} title="Numbered list">1. List</button>
      <button type="button" onMouseDown={event => { event.preventDefault(); addLink(); }} title="Add link">Link</button>
      <button type="button" onMouseDown={event => { event.preventDefault(); command('removeFormat'); }} title="Clear formatting">Clear</button>
    </div>
    <div
      ref={editorRef}
      className="rich-editor-surface"
      contentEditable="true"
      role="textbox"
      aria-multiline="true"
      aria-label="Event Description"
      tabIndex={0}
      inputMode="text"
      spellCheck="true"
      suppressContentEditableWarning
      onFocus={() => { editingRef.current = true; }}
      onInput={captureDraft}
      onBlur={() => { editingRef.current = false; commit(); }}
      onPaste={() => { window.setTimeout(captureDraft, 0); }}
    />
  </div>;
}

function AdminWagerBreakdown({ bets, pairTotal, currentPrizePool, archived = false }) {
  const wagerRows = Array.isArray(bets) ? bets.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))) : [];
  return <div className={`admin-wager-breakdown ${archived ? 'archived' : ''}`}>
    <div className="bettor-breakdown-heading">
      <span>WAGERS ON THIS PAIR</span>
      <strong>{wagerRows.length} {wagerRows.length === 1 ? 'bet' : 'bets'} • {currency(pairTotal)}</strong>
    </div>
    {wagerRows.length ? <div className="admin-wager-list">
      {wagerRows.map((bet, index) => {
        const wager = Number(bet.amount || 0);
        const payout = Number(pairTotal || 0) > 0 ? Number(currentPrizePool || 0) * (wager / Number(pairTotal || 0)) : 0;
        const when = bet.createdAt ? new Date(bet.createdAt) : null;
        return <div className="admin-wager-item" key={bet.id || `${bet.bettor}-${index}-${wager}`}>
          <div className="admin-wager-person"><span className="admin-wager-avatar">{playerInitials(bet.bettor)}</span><div><strong>{bet.bettor || 'Unknown Bettor'}</strong><span>{when && !Number.isNaN(when.getTime()) ? when.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Time unavailable'}</span></div></div>
          <div className="admin-wager-values"><div><span>Wager</span><strong>{currency(wager)}</strong></div><div><span>Projected Payout</span><strong>{currency(payout)}</strong></div></div>
        </div>;
      })}
    </div> : <div className="bettor-breakdown-empty">No bets have been placed on this pair.</div>}
  </div>;
}

const PAGE_TITLES = {
  dashboard: 'Dashboard',
  betting: 'Enter Bets',
  pairs: 'Pairs & Players',
  bets: 'Bet Ledger',
  settlement: 'Settlement',
  archives: 'Event Archives'
};

function Avatar({ name, photo, className = '' }) {
  const src = safePhotoSrc(photo);
  return (
    <span className={`player-avatar ${className}`.trim()}>
      {src ? <img src={src} alt="" /> : <span>{playerInitials(name)}</span>}
    </span>
  );
}

function PairAvatars({ pair, className = '' }) {
  if (!pair) return null;
  return (
    <span className={`pair-avatars ${className}`.trim()}>
      <Avatar name={pair.player1} photo={pair.player1Photo} />
      <Avatar name={pair.player2} photo={pair.player2Photo} />
    </span>
  );
}

function GroupBadge({ group }) {
  const challenge = group === 'Challenge';
  return <span className={`group-badge ${challenge ? 'challenge' : 'advantage'}`}>{group}</span>;
}

function ActionDialog({ dialog, onResult }) {
  if (!dialog) return null;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onMouseDown={event => {
      if (event.target === event.currentTarget) onResult(false);
    }}>
      <div className="modal card action-dialog-card">
        <div className={`dialog-icon ${dialog.danger ? 'danger' : ''}`}>{dialog.danger ? '!' : dialog.showCancel ? '?' : 'i'}</div>
        <div className="dialog-copy">
          <div className="eyebrow">{dialog.eyebrow || (dialog.showCancel ? 'CONFIRM ACTION' : 'NOTICE')}</div>
          <h3>{dialog.title || 'SmashPool'}</h3>
          <p>{dialog.message}</p>
        </div>
        <div className="dialog-actions">
          {dialog.showCancel && <button type="button" className="btn ghost" onClick={() => onResult(false)}>{dialog.cancelText || 'Cancel'}</button>}
          <button type="button" autoFocus={!dialog.showCancel} className={`btn primary ${dialog.danger ? 'dialog-danger' : ''}`} onClick={() => onResult(true)}>{dialog.confirmText || 'OK'}</button>
        </div>
      </div>
    </div>
  );
}

function SettingsModal({ open, state, onClose, onSave, onReset }) {
  const [name, setName] = useState(state.tournamentName);
  const [fee, setFee] = useState(state.feePercent);
  const [publicDashboardEnabled, setPublicDashboardEnabled] = useState(state.publicDashboardEnabled !== false);
  const [cutoffLocal, setCutoffLocal] = useState(toLocalDateTimeInputValue(state.bettingCutoffAt));
  const [descriptionHtml, setDescriptionHtml] = useState(state.eventDescriptionHtml || '');

  useEffect(() => {
    if (open) {
      setName(state.tournamentName);
      setFee(state.feePercent);
      setPublicDashboardEnabled(state.publicDashboardEnabled !== false);
      setCutoffLocal(toLocalDateTimeInputValue(state.bettingCutoffAt));
      setDescriptionHtml(state.eventDescriptionHtml || '');
    }
  }, [open, state.tournamentName, state.feePercent, state.publicDashboardEnabled, state.bettingCutoffAt, state.eventDescriptionHtml]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="modal card settings-modal-card">
        <div className="modal-header">
          <div><div className="eyebrow">POOL CONFIGURATION</div><h3>Settings</h3></div>
          <button className="icon-btn" type="button" onClick={onClose}>×</button>
        </div>
        <form onSubmit={event => {
          event.preventDefault();
          onSave(
            name.trim() || 'Badminton Championship Pool',
            Math.min(25, Math.max(0, Number(fee || 0))),
            publicDashboardEnabled,
            fromLocalDateTimeInputValue(cutoffLocal),
            sanitizeEventDescriptionHtml(descriptionHtml)
          );
        }}>
          <label>Tournament Name<input value={name} onChange={event => setName(event.target.value)} maxLength={80} /></label>
          <label>Organizer / Pool Deduction (%)<input value={fee} onChange={event => setFee(event.target.value)} type="number" min="0" max="25" step="0.5" /></label>
          <div className="callout">The prize pool equals total wagers minus this deduction. Set this to 0% if the organizer is not retaining any portion of the pool.</div>

          <label>Betting Cutoff Date &amp; Time
            <div className="cutoff-setting-row">
              <input value={cutoffLocal} onChange={event => setCutoffLocal(event.target.value)} type="datetime-local" />
              <button className="btn ghost" type="button" onClick={() => setCutoffLocal('')} disabled={!cutoffLocal}>Clear</button>
            </div>
          </label>
          <div className="callout">The cutoff uses your device's local date and time when saved. At zero, bet entry is disabled immediately and an active Admin session automatically persists Betting Closed to Firebase.</div>

          <div className="settings-field-group">
            <div className="settings-field-label">Event Description</div>
            <RichTextEditor value={descriptionHtml} onChange={setDescriptionHtml} />
          </div>
          <div className="callout">Use bold, italic, underline, lists, or links. This description appears on both the Admin and public dashboards and is preserved in Event Archives.</div>

          <div className="settings-toggle-row">
            <div className="settings-toggle-copy">
              <strong>Public Dashboard Visibility</strong>
              <span>{publicDashboardEnabled ? 'The live public dashboard is currently visible.' : 'The public portal will show “No Ongoing Events”.'}</span>
            </div>
            <button type="button" className={`settings-switch ${publicDashboardEnabled ? 'on' : ''}`} role="switch" aria-checked={publicDashboardEnabled} onClick={() => setPublicDashboardEnabled(current => !current)}>
              <span className="settings-switch-knob" />
              <span className="settings-switch-label">{publicDashboardEnabled ? 'Enabled' : 'Disabled'}</span>
            </button>
          </div>
          <div className="callout public-visibility-callout">When disabled, SmashPool removes the live event details from the public Firestore snapshot. Your Admin pool and Event Archives are not changed.</div>
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={onReset}>Reset Tournament</button>
            <button type="submit" className="btn primary">Save Settings</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Dashboard({ state, onView, onToggleBetting }) {
  const [expandedPairs, setExpandedPairs] = useState(() => new Set());
  const total = totalPool(state);
  const prize = prizePool(state);
  const bettingIsOpen = effectiveBettingOpen(state);
  const uniqueBettors = new Set(state.bets.map(bet => String(bet.bettor).trim().toLowerCase()).filter(Boolean)).size;
  const originalOrder = new Map(state.pairs.map((pair, index) => [pair.id, index]));
  const marketPairs = state.pairs.slice().sort((a, b) => {
    const difference = totalOnPair(state, b.id) - totalOnPair(state, a.id);
    return difference || originalOrder.get(a.id) - originalOrder.get(b.id);
  });
  const leader = marketPairs[0] && totalOnPair(state, marketPairs[0].id) > 0 ? marketPairs[0] : null;
  const recent = state.bets.slice().reverse().slice(0, 10);
  const togglePair = pairId => setExpandedPairs(current => {
    const next = new Set(current);
    if (next.has(pairId)) next.delete(pairId);
    else next.add(pairId);
    return next;
  });

  return (
    <>
      <div className="hero card">
        <div className="hero-copy">
          <div className="hero-tag-row"><div className="tag">LIVE POOL</div><CutoffCountdown cutoffAt={state.bettingCutoffAt} /></div>
          <h2>{state.tournamentName}</h2>
          <EventDescription html={state.eventDescriptionHtml} className="admin-event-description" />
          <div className="hero-actions">
            <button className="btn primary" onClick={() => onView('betting')} disabled={!bettingIsOpen}>Enter a Bet</button>
            <button className="btn ghost" onClick={onToggleBetting}>{bettingIsOpen ? 'Close Betting' : 'Reopen Betting'}</button>
          </div>
        </div>
        <div className="hero-orbit" aria-hidden="true"><div className="shuttle">◒</div><div className="orbit-ring ring-a" /><div className="orbit-ring ring-b" /></div>
      </div>

      <div className="stats-grid">
        <article className="stat-card card"><div className="stat-label">Total Pool</div><div className="stat-value">{currency(total)}</div><div className="stat-meta">All accepted bets</div></article>
        <article className="stat-card card"><div className="stat-label">Prize Pool</div><div className="stat-value">{currency(prize)}</div><div className="stat-meta">After {state.feePercent}% deduction</div></article>
        <article className="stat-card card"><div className="stat-label">Bettors</div><div className="stat-value">{uniqueBettors}</div><div className="stat-meta">{state.bets.length} total bets</div></article>
        <article className="stat-card card market-leader-card">
          <div className="stat-label">Most Bet-On Pair</div>
          <div className="market-leader-value-row">
            {leader && <PairAvatars pair={leader} className="leader-avatars" />}
            <div className="stat-value compact">{leader ? pairName(leader) : '—'}</div>
          </div>
          <div className="stat-meta">{leader ? `${currency(totalOnPair(state, leader.id))} wagered • ${pct(totalOnPair(state, leader.id) / total * 100)} of pool` : 'No bets yet'}</div>
        </article>
      </div>

      <div className="dashboard-grid">
        <section className="card panel wide-panel">
          <div className="panel-header"><div><div className="eyebrow">LIVE MARKET</div><h3>Projected Returns</h3></div><div className="legend"><span className="legend-dot" /> Click a pair to see named wagers</div></div>
          <div className="table-wrap"><table>
            <thead><tr><th>Pair</th><th>Group</th><th>Bet On Pair</th><th>Bettors</th><th>Pool Share</th><th>Projected Payout (On $5 Bet)</th></tr></thead>
            <tbody>
              {marketPairs.length === 0 ? <tr><td colSpan="6"><div className="empty-state">No pairs yet. Add a pair from Pairs & Players.</div></td></tr> : marketPairs.map(pair => {
                const onPair = totalOnPair(state, pair.id);
                const share = total ? onPair / total * 100 : 0;
                const fiveDollarProjection = projectedBet(state, pair.id, 5);
                const pairBets = state.bets.filter(bet => bet.pairId === pair.id);
                const expanded = expandedPairs.has(pair.id);
                return <React.Fragment key={pair.id}>
                  <tr className={`expandable-market-row admin-expandable-row ${expanded ? 'expanded' : ''}`} onClick={() => togglePair(pair.id)} aria-expanded={expanded}>
                    <td className="pair-cell"><div className="pair-identity"><PairAvatars pair={pair} className="market-avatars" /><div><strong>{pairName(pair)}</strong></div><span className="pair-expand-chevron" aria-hidden="true">⌄</span></div></td>
                    <td><GroupBadge group={pair.group} /></td>
                    <td className="money">{currency(onPair)}</td>
                    <td className="bettor-count">{bettorsOnPair(state, pair.id)}</td>
                    <td>{pct(share)}</td>
                    <td className="multiplier">{fiveDollarProjection ? currency(fiveDollarProjection.payout) : '—'}</td>
                  </tr>
                  {expanded && <tr className="bettor-breakdown-row admin-breakdown-row"><td colSpan="6"><AdminWagerBreakdown bets={pairBets} pairTotal={onPair} currentPrizePool={prize} /></td></tr>}
                </React.Fragment>;
              })}
            </tbody>
          </table></div>
        </section>

        <section className="card panel activity-panel">
          <div className="panel-header"><div><div className="eyebrow">RECENT</div><h3>Bet Activity</h3></div></div>
          <div className="activity-list">
            {recent.length ? recent.map(bet => {
              const pair = state.pairs.find(item => item.id === bet.pairId);
              return <div className="activity-item" key={bet.id}>
                <div className="activity-avatar">{playerInitials(bet.bettor)}</div>
                <div className="activity-copy"><strong>{bet.bettor}</strong><span>{pair?.group || '?'} • {pairName(pair)}</span></div>
                <div className="activity-amount">{currency(bet.amount)}</div>
              </div>;
            }) : <div className="empty-mini">No bets yet. Enter the first wager to start the market.</div>}
          </div>
        </section>
      </div>
    </>
  );
}

function PairOptions({ state }) {
  return GROUPS.map(group => {
    const pairs = state.pairs.filter(pair => pair.group === group);
    if (!pairs.length) return null;
    return <optgroup key={group} label={group}>{pairs.map(pair => <option value={pair.id} key={pair.id}>{pairName(pair)}</option>)}</optgroup>;
  });
}

function Betting({ state, updateState, toast, showNotice }) {
  const [bettor, setBettor] = useState('');
  const [pairId, setPairId] = useState('');
  const [amount, setAmount] = useState('');
  const [pending, setPending] = useState(false);
  const pair = state.pairs.find(item => item.id === pairId);
  const numericAmount = Number(amount || 0);
  const multiplier = pair && numericAmount > 0 ? pairMultiplier(state, pairId, numericAmount) : null;
  const bettingIsOpen = effectiveBettingOpen(state);
  const interactive = bettingIsOpen && !pending;

  useEffect(() => {
    if (pairId && !state.pairs.some(item => item.id === pairId)) setPairId('');
  }, [state.pairs, pairId]);

  async function submit(event) {
    event.preventDefault();
    if (!effectiveBettingOpen(state)) { toast(cutoffReached(state.bettingCutoffAt) ? 'Betting cutoff has been reached' : 'Betting is currently closed'); return; }
    const name = bettor.trim();
    if (!name || !pairId || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      await showNotice('Enter a bettor name, select a pair, and enter a valid amount.', { title: 'Incomplete bet' });
      return;
    }
    setPending(true);
    const bet = { id: crypto.randomUUID(), bettor: name, pairId, amount: numericAmount, createdAt: new Date().toISOString() };
    updateState(current => ({ ...current, bets: [...current.bets, bet], settledWinnerId: null, preSettlementBettingOpen: null }));
    setAmount('');
    toast(`${currency(numericAmount)} bet added`);
    setPending(false);
  }

  return (
    <div className="split-layout">
      <section className="card form-card">
        <div className="panel-header"><div><div className="eyebrow">NEW WAGER</div><h3>Enter Bet</h3></div><div className="betting-status-stack"><span className={`pill ${bettingIsOpen ? 'open' : 'closed'}`}>{bettingIsOpen ? 'OPEN' : 'CLOSED'}</span><CutoffCountdown cutoffAt={state.bettingCutoffAt} /></div></div>
        <form id="betForm" onSubmit={submit}>
          <label>Bettor Name<input value={bettor} onChange={event => setBettor(event.target.value)} disabled={!interactive} required maxLength={60} placeholder="e.g. Joseph" autoComplete="off" /></label>
          <label>Select Pair<select value={pairId} onChange={event => setPairId(event.target.value)} disabled={!interactive} required><option value="">Choose a pair...</option><PairOptions state={state} /></select></label>
          <label>Amount<div className="money-input"><span>$</span><input value={amount} onChange={event => setAmount(event.target.value)} disabled={!interactive} type="number" min="1" step="1" required placeholder="20" /></div></label>
          <div className="quick-amounts">{[5,10,20,50,100].map(value => <button type="button" disabled={!interactive} key={value} onClick={() => setAmount(String(value))}>${value}</button>)}</div>
          <div className="bet-preview">
            <div><span>Selected Pair</span><strong>{pair ? `${pair.group} • ${currency(totalOnPair(state, pairId))} wagered` : '—'}</strong></div>
            <div><span>Projected Multiplier</span><strong>{multiplier ? `${multiplier.toFixed(2)}×` : '—'}</strong></div>
            <div><span>Projected Return</span><strong>{multiplier ? currency(numericAmount * multiplier) : '—'}</strong></div>
          </div>
          <button className="btn primary full" type="submit" disabled={!interactive}>{!bettingIsOpen ? (cutoffReached(state.bettingCutoffAt) ? 'Betting Cutoff Reached' : 'Betting is Closed') : pending ? 'Saving Bet…' : 'Add Bet to Pool'}</button>
        </form>
      </section>

      <section className="card panel">
        <div className="panel-header"><div><div className="eyebrow">SHOP THE ODDS</div><h3>Pair Board</h3></div></div>
        <div className="pair-board">
          {state.pairs.length ? state.pairs.map(item => {
            const currentMultiplier = pairMultiplier(state, item.id);
            return <button type="button" className="pair-tile" key={item.id} onClick={() => setPairId(item.id)}>
              <div className="pair-tile-top"><div className="pair-tile-identity"><PairAvatars pair={item} className="board-avatars" /><div><h4>{pairName(item)}</h4><small>{item.group}</small></div></div></div>
              <div className="pair-tile-bottom"><div><span>WAGERED</span><strong>{currency(totalOnPair(state, item.id))}</strong></div><div><span>CURRENT RETURN</span><strong className="multiplier">{currentMultiplier ? `${currentMultiplier.toFixed(2)}×` : '—'}</strong></div></div>
            </button>;
          }) : <div className="empty-state">No pairs yet. Add one from Pairs & Players.</div>}
        </div>
      </section>
    </div>
  );
}

function PlayerEditor({ pair, player, onName, onPhoto, onRemovePhoto }) {
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const name = pair[`player${player}`];
  const photo = pair[`player${player}Photo`];

  async function pickPhoto(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      await onPhoto(pair.id, player, file);
    } finally {
      setLoading(false);
      event.target.value = '';
    }
  }

  return (
    <div className="player-editor-row">
      <button type="button" className={`photo-picker ${loading ? 'loading' : ''}`} title={`Add or change ${name} profile picture`} onClick={() => inputRef.current?.click()}>
        <Avatar name={name} photo={photo} className="editor-avatar" /><span className="photo-edit-badge">{safePhotoSrc(photo) ? '✎' : '+'}</span>
      </button>
      <label className="player-name-field"><span>PLAYER {player}</span><input value={name} onChange={event => onName(pair.id, player, event.target.value)} maxLength={40} /></label>
      <button type="button" className={`remove-photo icon-mini ${safePhotoSrc(photo) ? '' : 'hidden'}`} onClick={() => onRemovePhoto(pair.id, player)} title="Remove profile picture">×</button>
      <input ref={inputRef} type="file" className="hidden" onChange={pickPhoto} accept="image/png,image/jpeg,image/webp,image/gif" />
    </div>
  );
}

function Pairs({ state, updateState, toast, showConfirm, showNotice }) {
  const [draggedId, setDraggedId] = useState(null);
  const [dragOver, setDragOver] = useState(null);

  function updateName(pairId, player, value) {
    updateState(current => ({ ...current, pairs: current.pairs.map(pair => pair.id === pairId ? { ...pair, [`player${player}`]: value } : pair) }));
  }

  async function updatePhoto(pairId, player, file) {
    try {
      const prepared = await resizeProfilePhoto(file);
      const photo = await uploadProfilePhoto(pairId, player, prepared);
      updateState(current => ({ ...current, pairs: current.pairs.map(pair => pair.id === pairId ? { ...pair, [`player${player}Photo`]: photo } : pair) }));
      toast('Profile picture uploaded');
    } catch (error) {
      console.error(error);
      await showNotice(error?.message || 'That image could not be loaded.', { title: 'Profile picture' });
    }
  }

  async function removePhoto(pairId, player) {
    try { await deleteProfilePhoto(pairId, player); } catch (error) { console.warn('Unable to delete stored photo:', error); }
    updateState(current => ({ ...current, pairs: current.pairs.map(pair => pair.id === pairId ? { ...pair, [`player${player}Photo`]: null } : pair) }));
    toast('Profile picture removed');
  }

  function addPair(group) {
    updateState(current => {
      const n = nextPairNumber(current.pairs);
      const pair = { id: crypto.randomUUID(), group, player1: `Pair ${n}A`, player2: `Pair ${n}B`, player1Photo: null, player2Photo: null };
      const pairs = current.pairs.slice();
      const lastIndex = pairs.reduce((last, item, index) => item.group === group ? index : last, -1);
      if (lastIndex >= 0) pairs.splice(lastIndex + 1, 0, pair);
      else if (group === 'Advantage') pairs.unshift(pair);
      else pairs.push(pair);
      return { ...current, pairs };
    });
    toast(`Pair added to ${group}`);
  }

  async function deletePair(pairId) {
    const pair = state.pairs.find(item => item.id === pairId);
    if (!pair) return;
    const linkedBets = state.bets.filter(bet => bet.pairId === pairId);
    const settlementAffected = Boolean(state.settledWinnerId) && (state.settledWinnerId === pairId || linkedBets.length > 0);
    const betWarning = linkedBets.length ? ` This will also permanently remove ${linkedBets.length} bet${linkedBets.length === 1 ? '' : 's'} totaling ${currency(linkedBets.reduce((sum, bet) => sum + Number(bet.amount), 0))}.` : '';
    const settlementWarning = settlementAffected ? ' The finalized payout will be undone because the pool is changing.' : '';
    const ok = await showConfirm(`Delete ${pairName(pair)} from ${pair.group}?${betWarning}${settlementWarning}`, { title: 'Delete pair?', confirmText: 'Delete Pair', danger: true });
    if (!ok) return;
    await Promise.allSettled([deleteProfilePhoto(pairId, 1), deleteProfilePhoto(pairId, 2)]);
    updateState(current => {
      const restoreOpen = typeof current.preSettlementBettingOpen === 'boolean' ? current.preSettlementBettingOpen : current.bettingOpen;
      return {
        ...current,
        pairs: current.pairs.filter(item => item.id !== pairId),
        bets: linkedBets.length ? current.bets.filter(bet => bet.pairId !== pairId) : current.bets,
        settledWinnerId: settlementAffected || current.settledWinnerId === pairId ? null : current.settledWinnerId,
        settlementPreviewWinnerId: current.settlementPreviewWinnerId === pairId ? null : current.settlementPreviewWinnerId,
        preSettlementBettingOpen: settlementAffected || current.settledWinnerId === pairId ? null : current.preSettlementBettingOpen,
        bettingOpen: settlementAffected || current.settledWinnerId === pairId ? restoreOpen : current.bettingOpen
      };
    });
    toast('Pair deleted');
  }

  function movePair(pairId, targetGroup) {
    updateState(current => {
      const index = current.pairs.findIndex(pair => pair.id === pairId);
      if (index < 0 || current.pairs[index].group === targetGroup) return current;
      const pairs = current.pairs.slice();
      const [existingPair] = pairs.splice(index, 1);
      const pair = { ...existingPair, group: targetGroup };
      const lastTarget = pairs.reduce((last, item, itemIndex) => item.group === targetGroup ? itemIndex : last, -1);
      if (lastTarget >= 0) pairs.splice(lastTarget + 1, 0, pair);
      else if (targetGroup === 'Advantage') pairs.unshift(pair);
      else pairs.push(pair);
      return { ...current, pairs };
    });
    toast(`Pair moved to ${targetGroup}`);
  }

  return (
    <section className="card panel">
      <div className="panel-header"><div><div className="eyebrow">PRE-TOURNAMENT</div><h3>Pairs & Players</h3></div><button className="btn secondary" type="button" onClick={() => toast('Pair changes saved')}>Save Changes</button></div>
      <p className="muted intro-text">Manage any number of pairs, then drag cards between the Advantage and Challenge groups. Click a player photo to add or replace it. Changes are saved automatically to Firebase and published to the live dashboard.</p>
      <div className="group-columns pair-groups">
        {GROUPS.map(group => {
          const groupPairs = state.pairs.filter(pair => pair.group === group);
          return <section className="pair-group-zone" data-group={group} key={group}>
            <div className="group-header-row"><div><div className={`group-heading ${group === 'Challenge' ? 'challenge-heading' : ''}`}>{group.toUpperCase()}</div><div className="group-count">{groupPairs.length} pair{groupPairs.length === 1 ? '' : 's'}</div></div><button type="button" className="btn secondary compact-btn" onClick={() => addPair(group)}>+ Add Pair</button></div>
            <div className={`pair-editor-list pair-drop-zone ${dragOver === group ? 'drag-over' : ''}`} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragOver(group); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDragOver(null); }} onDrop={event => {
              event.preventDefault();
              const pairId = draggedId || event.dataTransfer.getData('text/plain');
              setDragOver(null);
              setDraggedId(null);
              if (pairId) movePair(pairId, group);
            }}>
              {groupPairs.length ? groupPairs.map(pair => <div className={`pair-editor ${draggedId === pair.id ? 'dragging' : ''}`} key={pair.id}>
                <div className="pair-editor-toolbar">
                  <div className="drag-handle" draggable title="Drag to move this pair" onDragStart={event => { setDraggedId(pair.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', pair.id); }} onDragEnd={() => { setDraggedId(null); setDragOver(null); }}><span className="drag-dots">⋮⋮</span><span>Drag pair</span></div>
                  <GroupBadge group={group} />
                  <button type="button" className="delete-pair icon-mini" onClick={() => deletePair(pair.id)} title="Delete pair">×</button>
                </div>
                <PlayerEditor pair={pair} player={1} onName={updateName} onPhoto={updatePhoto} onRemovePhoto={removePhoto} />
                <PlayerEditor pair={pair} player={2} onName={updateName} onPhoto={updatePhoto} onRemovePhoto={removePhoto} />
              </div>) : <div className="drop-empty">Drop pairs here or add a new pair.</div>}
            </div>
          </section>;
        })}
      </div>
    </section>
  );
}

function Ledger({ state, updateState, toast, showConfirm }) {
  const [bettorQuery, setBettorQuery] = useState('');
  const [playerQuery, setPlayerQuery] = useState('');
  const rows = state.bets.slice().reverse().filter(bet => {
    const bettorQ = bettorQuery.trim().toLowerCase();
    const playerQ = playerQuery.trim().toLowerCase();
    const pair = state.pairs.find(item => item.id === bet.pairId);
    const bettorMatches = !bettorQ || bet.bettor.toLowerCase().includes(bettorQ);
    const playerMatches = !playerQ || pairName(pair).toLowerCase().includes(playerQ);
    return bettorMatches && playerMatches;
  });

  async function deleteBet(betId) {
    if (!(await showConfirm('Delete this bet from the ledger?', { title: 'Delete bet?', confirmText: 'Delete Bet', danger: true }))) return;
    updateState(current => {
      const restoreOpen = current.settledWinnerId && typeof current.preSettlementBettingOpen === 'boolean' ? current.preSettlementBettingOpen : current.bettingOpen;
      return { ...current, bets: current.bets.filter(bet => bet.id !== betId), settledWinnerId: null, preSettlementBettingOpen: null, bettingOpen: restoreOpen };
    });
    toast('Bet removed');
  }

  async function clearBets() {
    if (!state.bets.length) return;
    if (!(await showConfirm('This will permanently remove every bet from this tournament.', { title: 'Clear all bets?', confirmText: 'Clear All Bets', danger: true }))) return;
    updateState(current => {
      const restoreOpen = current.settledWinnerId && typeof current.preSettlementBettingOpen === 'boolean' ? current.preSettlementBettingOpen : current.bettingOpen;
      return { ...current, bets: [], settledWinnerId: null, preSettlementBettingOpen: null, bettingOpen: restoreOpen };
    });
    toast('All bets cleared');
  }

  return <section className="card panel">
    <div className="panel-header"><div><div className="eyebrow">AUDIT TRAIL</div><h3>Bet Ledger</h3></div><div className="inline-actions ledger-filters"><input className="search" value={bettorQuery} onChange={event => setBettorQuery(event.target.value)} placeholder="Search Bettor" aria-label="Search Bettor" /><input className="search" value={playerQuery} onChange={event => setPlayerQuery(event.target.value)} placeholder="Search Player" aria-label="Search Player" /><button className="btn danger subtle" onClick={clearBets}>Clear Bets</button></div></div>
    <div className="table-wrap"><table><thead><tr><th>Time</th><th>Bettor</th><th>Pair</th><th>Group</th><th>Amount</th><th></th></tr></thead><tbody>
      {rows.length ? rows.map(bet => {
        const pair = state.pairs.find(item => item.id === bet.pairId);
        return <tr key={bet.id}><td>{new Date(bet.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</td><td><strong>{bet.bettor}</strong></td><td>{pairName(pair)}</td><td>{pair ? <GroupBadge group={pair.group} /> : '?'}</td><td className="money">{currency(bet.amount)}</td><td><button className="delete-bet" onClick={() => deleteBet(bet.id)} title="Delete bet">×</button></td></tr>;
      }) : <tr><td colSpan="6"><div className="empty-state">No matching bets.</div></td></tr>}
    </tbody></table></div>
  </section>;
}

function Settlement({ state, updateState, toast, showConfirm, showNotice }) {
  const [winnerId, setWinnerId] = useState(state.settledWinnerId || state.settlementPreviewWinnerId || '');
  const finalized = Boolean(state.settledWinnerId);
  const activeWinner = state.settledWinnerId || state.settlementPreviewWinnerId || winnerId;
  const pair = state.pairs.find(item => item.id === activeWinner);
  const calc = activeWinner ? calculateSettlement(state, activeWinner) : null;

  useEffect(() => {
    const storedWinner = state.settledWinnerId || state.settlementPreviewWinnerId || '';
    if (storedWinner) setWinnerId(storedWinner);
    else if (winnerId && !state.pairs.some(pair => pair.id === winnerId)) setWinnerId('');
  }, [state.settledWinnerId, state.settlementPreviewWinnerId, state.pairs, winnerId]);

  async function finalize() {
    if (!winnerId) { await showNotice('Select the winning pair first.', { title: 'Winning pair required' }); return; }
    const winner = state.pairs.find(item => item.id === winnerId);
    if (!(await showConfirm(`Finalize settlement for ${pairName(winner)}? Betting will be closed when the settlement is finalized.`, { title: 'Finalize settlement?', confirmText: 'Finalize' }))) return;
    updateState(current => ({ ...current, preSettlementBettingOpen: current.bettingOpen, settledWinnerId: winnerId, settlementPreviewWinnerId: winnerId, bettingOpen: false }));
    toast('Pool settlement finalized');
  }

  async function undo() {
    const currentPair = state.pairs.find(item => item.id === state.settledWinnerId);
    const restoreOpen = typeof state.preSettlementBettingOpen === 'boolean' ? state.preSettlementBettingOpen : true;
    if (!(await showConfirm(`Undo the final payout for ${pairName(currentPair)}? The bets will remain unchanged and the settlement will return to preview mode.`, { title: 'Undo final payout?', confirmText: 'Undo Final Payout' }))) return;
    updateState(current => ({ ...current, settledWinnerId: null, settlementPreviewWinnerId: current.settlementPreviewWinnerId || currentPair?.id || null, bettingOpen: restoreOpen, preSettlementBettingOpen: null }));
    toast(restoreOpen ? 'Final payout undone • Betting reopened' : 'Final payout undone');
  }

  async function exportCsv() {
    if (!activeWinner) { await showNotice('Select a winning pair first.', { title: 'Winning pair required' }); return; }
    const csv = settlementCsv(state, activeWinner);
    downloadText('badminton-pool-settlement.csv', csv, 'text/csv;charset=utf-8');
    toast('Settlement CSV exported');
  }

  return <div className="split-layout settlement-layout">
    <section className="card form-card">
      <div className="panel-header"><div><div className="eyebrow">FINAL RESULT</div><h3>Settle Pool</h3></div></div>
      <label>Winning Pair<select value={activeWinner} disabled={finalized} onChange={event => { const nextWinner = event.target.value; setWinnerId(nextWinner); updateState(current => ({ ...current, settlementPreviewWinnerId: nextWinner || null })); }}><option value="">Choose winning pair...</option><PairOptions state={state} /></select></label>
      <div className="settlement-summary">
        <div className="summary-line"><span>Total Pool</span><strong>{currency(totalPool(state))}</strong></div>
        <div className="summary-line"><span>Deduction ({state.feePercent}%)</span><strong>{currency(totalPool(state) - prizePool(state))}</strong></div>
        <div className="summary-line"><span>Prize Pool</span><strong>{currency(prizePool(state))}</strong></div>
        <div className="summary-line"><span>Winning Pair Bets</span><strong>{calc ? currency(calc.winnerTotal) : '—'}</strong></div>
      </div>
      <button className="btn primary full" disabled={finalized} onClick={finalize}>{finalized ? 'Final Payouts Calculated' : 'Calculate Final Payouts'}</button>
      {finalized && <button className="btn secondary full" onClick={undo}>↶ Undo Final Payout</button>}
      <button className="btn ghost full" onClick={exportCsv}>Export Settlement CSV</button>
    </section>
    <section className="card panel">
      <div className="panel-header"><div><div className="eyebrow">PAYOUTS</div><h3>Winner Distribution</h3></div><span className={`pill ${finalized ? 'open' : ''}`}>{finalized ? 'FINAL' : 'PREVIEW'}</span></div>
      <div className="table-wrap"><table><thead><tr><th>Bettor</th><th>Winning Bet</th><th>Share</th><th>Total Return</th><th>Profit</th></tr></thead><tbody>
        {!calc || !pair ? <tr><td colSpan="5"><div className="empty-state">Select a winning pair to preview payouts.</div></td></tr> : calc.payouts.map(item => <tr key={item.id}><td>{item.bettor}</td><td>{currency(item.amount)}</td><td>{pct(item.share * 100)}</td><td className="money"><strong>{currency(item.payout)}</strong></td><td className="profit-positive">+{currency(Math.max(0, item.profit))}</td></tr>)}
      </tbody></table></div>
      {calc && pair && calc.payouts.length === 0 && <div className="empty-state">No wagers were placed on this pair. The pool can be refunded or handled according to your posted rules.</div>}
    </section>
  </div>;
}


function ArchiveDate({ archive }) {
  const value = archive?.archivedAt?.toDate?.() || (archive?.archivedAtIso ? new Date(archive.archivedAtIso) : null);
  if (!value || Number.isNaN(value.getTime())) return <span>Archived event</span>;
  return <span>{value.toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>;
}

function EventArchives({ archives, loading, error, selectedId, onSelect, onArchiveCurrent }) {
  const selected = archives.find(item => item.id === selectedId) || archives[0] || null;
  const archivedState = selected?.state ? migrateState(selected.state) : null;
  const dashboard = selected?.dashboard || null;
  const settlement = selected?.settlement || null;
  const pairById = new Map((archivedState?.pairs || []).map(pair => [pair.id, pair]));
  const archivedPairs = (dashboard?.pairs || []).map(pair => ({ ...(pairById.get(pair.id) || {}), ...pair }));
  const ledger = archivedState?.bets?.slice().reverse() || [];
  const [expandedPairs, setExpandedPairs] = useState(() => new Set());
  const [bettorQuery, setBettorQuery] = useState('');
  const [playerQuery, setPlayerQuery] = useState('');

  useEffect(() => {
    setExpandedPairs(new Set());
    setBettorQuery('');
    setPlayerQuery('');
  }, [selected?.id]);

  const togglePair = pairId => setExpandedPairs(current => {
    const next = new Set(current);
    if (next.has(pairId)) next.delete(pairId);
    else next.add(pairId);
    return next;
  });

  const bettorQ = bettorQuery.trim().toLowerCase();
  const playerQ = playerQuery.trim().toLowerCase();
  const filteredLedger = ledger.filter(bet => {
    const pair = pairById.get(bet.pairId);
    const bettorMatches = !bettorQ || String(bet.bettor || '').toLowerCase().includes(bettorQ);
    const playerMatches = !playerQ || pairName(pair).toLowerCase().includes(playerQ);
    return bettorMatches && playerMatches;
  });
  const archiveCutoff = dashboard?.bettingCutoffAt || selected?.state?.bettingCutoffAt || null;
  const archiveDescription = dashboard?.eventDescriptionHtml || selected?.state?.eventDescriptionHtml || '';

  return <div className="archive-layout">
    <section className="card panel archive-index-panel">
      <div className="panel-header archive-index-header">
        <div><div className="eyebrow">HISTORICAL RECORDS</div><h3>Event Archives</h3></div>
        <button type="button" className="btn primary" onClick={onArchiveCurrent}>Archive Current Event</button>
      </div>
      <p className="muted archive-intro">Archives are frozen private snapshots. Reviewing one does not change the live tournament.</p>
      {loading ? <div className="empty-state">Loading archived events…</div> : error ? <div className="auth-error">{error}</div> : archives.length ? <div className="archive-list">
        {archives.map(archive => {
          const summary = archive.dashboard || {};
          const isSelected = selected?.id === archive.id;
          return <button type="button" className={`archive-list-item ${isSelected ? 'active' : ''}`} key={archive.id} onClick={() => onSelect(archive.id)}>
            <div className="archive-list-title">{archive.tournamentName || 'Untitled Event'}</div>
            <div className="archive-list-date"><ArchiveDate archive={archive} /></div>
            <div className="archive-list-meta"><span>{currency(summary.totalPool || 0)} pool</span><span>{Number(summary.totalBets || 0)} bets</span><span className={`archive-status ${archive.settlement?.finalized ? 'finalized' : ''}`}>{archive.settlement?.finalized ? 'Finalized' : (archive.settlement?.hasPreview ? 'Preview' : 'Unsettled')}</span></div>
          </button>;
        })}
      </div> : <div className="empty-state">No archived events yet. Use “Archive Current Event” to preserve the current pool.</div>}
    </section>

    <section className="archive-review">
      {!selected ? <div className="card panel"><div className="empty-state">Select an archived event to review it.</div></div> : <>
        <section className="card panel archive-review-header">
          <div className="archive-review-title"><div className="eyebrow">ARCHIVED EVENT</div><h2>{selected.tournamentName}</h2><div className="archive-review-meta"><ArchiveDate archive={selected} />{selected.archivedBy ? <span>Archived by {selected.archivedBy}</span> : null}<span>Snapshot v{selected.schemaVersion || 1}</span>{archiveCutoff ? <span>Cutoff {new Date(archiveCutoff).toLocaleString()}</span> : <span>No cutoff set</span>}</div><EventDescription html={archiveDescription} className="archive-event-description" /></div>
          <span className={`pill ${settlement?.finalized ? 'open' : ''}`}>{settlement?.finalized ? 'FINALIZED' : (settlement?.hasPreview ? 'PREVIEW' : 'UNSETTLED')}</span>
        </section>

        <div className="stats-grid archive-stats-grid">
          <article className="stat-card card"><div className="stat-label">Total Pool</div><div className="stat-value">{currency(dashboard?.totalPool || 0)}</div><div className="stat-meta">{Number(dashboard?.totalBets || 0)} accepted bets</div></article>
          <article className="stat-card card"><div className="stat-label">Prize Pool</div><div className="stat-value">{currency(dashboard?.prizePool || 0)}</div><div className="stat-meta">After {Number(dashboard?.feePercent || 0)}% deduction</div></article>
          <article className="stat-card card"><div className="stat-label">Bettors</div><div className="stat-value">{Number(dashboard?.uniqueBettors || 0)}</div><div className="stat-meta">Unique bettors</div></article>
          <article className="stat-card card"><div className="stat-label">Most Bet-On Pair</div><div className="stat-value compact">{dashboard?.leaderName || '—'}</div><div className="stat-meta">{dashboard?.leaderName ? `${currency(dashboard.leaderBetTotal || 0)} wagered` : 'No bets recorded'}</div></article>
        </div>

        <section className="card panel archive-section">
          <div className="panel-header"><div><div className="eyebrow">FROZEN DASHBOARD</div><h3>Projected Returns</h3></div><div className="archive-market-status"><span className={`pill ${dashboard?.bettingOpen ? 'open' : ''}`}>{dashboard?.bettingOpen ? 'BETTING OPEN' : 'BETTING CLOSED'}</span><span className="legend"><span className="legend-dot" /> Click a pair to see named wagers</span></div></div>
          <div className="table-wrap"><table><thead><tr><th>Pair</th><th>Group</th><th>Bet On Pair</th><th>Bettors</th><th>Pool Share</th><th>Projected Payout (On $5 Bet)</th></tr></thead><tbody>
            {archivedPairs.length ? archivedPairs.map(pair => {
              const expanded = expandedPairs.has(pair.id);
              const pairBets = (archivedState?.bets || []).filter(bet => bet.pairId === pair.id);
              const projected = pair.projectedPayoutOn5 ?? pair.projectedReturnOn5 ?? pair.fivePays ?? null;
              return <React.Fragment key={pair.id}>
                <tr className={`expandable-market-row admin-expandable-row ${expanded ? 'expanded' : ''}`} onClick={() => togglePair(pair.id)} aria-expanded={expanded}>
                  <td className="pair-cell"><div className="pair-identity"><PairAvatars pair={pair} className="market-avatars" /><strong>{pairName(pair)}</strong><span className="pair-expand-chevron" aria-hidden="true">⌄</span></div></td>
                  <td><GroupBadge group={pair.group} /></td><td className="money">{currency(pair.betTotal)}</td><td>{Number(pair.bettorCount || 0)}</td><td>{pct(pair.poolShare)}</td><td className="money multiplier">{projected != null ? currency(projected) : '—'}</td>
                </tr>
                {expanded && <tr className="bettor-breakdown-row admin-breakdown-row"><td colSpan="6"><AdminWagerBreakdown bets={pairBets} pairTotal={Number(pair.betTotal || 0)} currentPrizePool={Number(dashboard?.prizePool || 0)} archived /></td></tr>}
              </React.Fragment>;
            }) : <tr><td colSpan="6"><div className="empty-state">No pairs in this archived event.</div></td></tr>}
          </tbody></table></div>
        </section>

        <section className="card panel archive-section">
          <div className="panel-header"><div><div className="eyebrow">DASHBOARD ACTIVITY</div><h3>Recent Bet Activity</h3></div><span className="archive-count">Last {Math.min(10, Number(dashboard?.totalBets || 0))} bets</span></div>
          <div className="activity-list archive-activity-list">
            {dashboard?.recentBets?.length ? dashboard.recentBets.map(bet => <div className="activity-item" key={bet.id}><div className="activity-avatar">{playerInitials(bet.bettor)}</div><div className="activity-copy"><strong>{bet.bettor}</strong><span>{bet.group || '?'} • {bet.pairName}</span></div><div className="activity-amount">{currency(bet.amount)}</div></div>) : <div className="empty-mini">No recent betting activity was recorded.</div>}
          </div>
        </section>

        <section className="card panel archive-section">
          <div className="panel-header"><div><div className="eyebrow">ROSTER SNAPSHOT</div><h3>Pairs &amp; Players</h3></div><span className="archive-count">{archivedState?.pairs?.length || 0} pairs</span></div>
          <div className="archive-roster-grid">
            {(archivedState?.pairs || []).map(pair => <article className="archive-pair-card" key={pair.id}><div className="archive-pair-top"><PairAvatars pair={pair} className="archive-pair-avatars" /><GroupBadge group={pair.group} /></div><strong>{pair.player1}</strong><span>&amp;</span><strong>{pair.player2}</strong></article>)}
          </div>
        </section>

        <section className="card panel archive-section">
          <div className="panel-header archive-ledger-header"><div><div className="eyebrow">AUDIT TRAIL</div><h3>Complete Bet Ledger</h3></div><div className="inline-actions ledger-filters archive-ledger-filters"><input className="search" value={bettorQuery} onChange={event => setBettorQuery(event.target.value)} placeholder="Search Bettor" aria-label="Search archived bettor" /><input className="search" value={playerQuery} onChange={event => setPlayerQuery(event.target.value)} placeholder="Search Player" aria-label="Search archived player" /><span className="archive-count">{filteredLedger.length === ledger.length ? `${ledger.length} bets` : `${filteredLedger.length} of ${ledger.length} bets`}</span></div></div>
          <div className="table-wrap"><table><thead><tr><th>Date / Time</th><th>Bettor</th><th>Pair</th><th>Group</th><th>Amount</th></tr></thead><tbody>
            {filteredLedger.length ? filteredLedger.map(bet => { const pair = pairById.get(bet.pairId); return <tr key={bet.id}><td>{bet.createdAt ? new Date(bet.createdAt).toLocaleString([], { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }) : '—'}</td><td><strong>{bet.bettor}</strong></td><td>{pairName(pair)}</td><td>{pair ? <GroupBadge group={pair.group} /> : '?'}</td><td className="money">{currency(bet.amount)}</td></tr>; }) : <tr><td colSpan="5"><div className="empty-state">No matching archived bets.</div></td></tr>}
          </tbody></table></div>
        </section>

        <section className="card panel archive-section">
          <div className="panel-header"><div><div className="eyebrow">SETTLEMENT SNAPSHOT</div><h3>{settlement?.finalized ? 'Final Payout' : (settlement?.hasPreview ? 'Payout Preview' : 'Settlement Not Finalized')}</h3></div><span className={`pill ${settlement?.finalized ? 'open' : ''}`}>{settlement?.finalized ? 'FINAL' : (settlement?.hasPreview ? 'PREVIEW' : 'UNSETTLED')}</span></div>
          <div className="archive-settlement-summary">
            <div className="summary-line"><span>Total Pool</span><strong>{currency(settlement?.totalPool || dashboard?.totalPool || 0)}</strong></div>
            <div className="summary-line"><span>Deduction</span><strong>{currency(settlement?.deduction || 0)}</strong></div>
            <div className="summary-line"><span>Prize Pool</span><strong>{currency(settlement?.prizePool || dashboard?.prizePool || 0)}</strong></div>
            <div className="summary-line"><span>Winning Pair</span><strong>{settlement?.winnerName || 'Not set'}</strong></div>
            <div className="summary-line"><span>Winning Pair Bets</span><strong>{settlement?.winnerName ? currency(settlement.winnerTotal || 0) : '—'}</strong></div>
          </div>
          {settlement?.winnerName ? <div className="table-wrap archive-payout-table"><table><thead><tr><th>Bettor</th><th>Winning Bet</th><th>Share</th><th>Total Return</th><th>Profit</th></tr></thead><tbody>
            {settlement.payouts?.length ? settlement.payouts.map(item => <tr key={item.id}><td>{item.bettor}</td><td>{currency(item.amount)}</td><td>{pct(Number(item.share || 0) * 100)}</td><td className="money"><strong>{currency(item.payout)}</strong></td><td>{item.profit >= 0 ? '+' : ''}{currency(item.profit)}</td></tr>) : <tr><td colSpan="5"><div className="empty-state">The winning pair had no wagers.</div></td></tr>}
          </tbody></table></div> : <div className="archive-unsettled-note">This event was archived before a winning pair was selected. The complete pool, roster, and ledger are still preserved above.</div>}
          {settlement?.hasPreview && <div className="archive-unsettled-note archive-preview-note">This payout distribution was captured in preview mode and was not finalized at the time of archiving.</div>}
        </section>
      </>}
    </section>
  </div>;
}

function AdminApp({ user }) {
  const [state, setState] = useState(makeDefaultState);
  const [hydrated, setHydrated] = useState(false);
  const [view, setView] = useState('dashboard');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [archives, setArchives] = useState([]);
  const [archivesLoading, setArchivesLoading] = useState(false);
  const [archivesError, setArchivesError] = useState('');
  const [selectedArchiveId, setSelectedArchiveId] = useState('');
  const [toastMessage, setToastMessage] = useState('');
  const [dialog, setDialog] = useState(null);
  const dialogResolver = useRef(null);
  const importRef = useRef(null);
  const saveTimer = useRef(null);
  const saveQueue = useRef(Promise.resolve());
  const toastTimer = useRef(null);
  const cutoffCloseRef = useRef('');

  useEffect(() => {
    let alive = true;
    loadAdminState().then(saved => {
      if (!alive) return;
      const next = migrateState(saved || makeDefaultState());
      setState(next);
      setHydrated(true);
      if (!saved) saveAdminState(next).catch(error => console.error('Unable to initialize Firebase pool:', error));
    }).catch(error => {
      console.error('Unable to load Firebase tournament:', error);
      if (alive) {
        setState(makeDefaultState());
        setHydrated(true);
      }
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!hydrated) return undefined;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const snapshot = state;
      saveQueue.current = saveQueue.current
        .catch(() => {})
        .then(() => saveAdminState(snapshot))
        .catch(error => {
          console.error('Unable to persist tournament to Firebase:', error);
          toast('Firebase save failed');
        });
    }, 180);
    return () => clearTimeout(saveTimer.current);
  }, [state, hydrated]);

  useEffect(() => {
    if (!hydrated || !state.bettingOpen || !state.bettingCutoffAt) return undefined;
    const closeAtCutoff = () => {
      if (!cutoffReached(state.bettingCutoffAt)) return;
      if (cutoffCloseRef.current === state.bettingCutoffAt) return;
      cutoffCloseRef.current = state.bettingCutoffAt;
      setState(current => effectiveBettingOpen(current) ? current : ({ ...current, bettingOpen: false }));
      toast('Betting cutoff reached • Betting closed');
    };
    closeAtCutoff();
    const timer = window.setInterval(closeAtCutoff, 1000);
    return () => window.clearInterval(timer);
  }, [hydrated, state.bettingOpen, state.bettingCutoffAt]);

  useEffect(() => {
    if (view !== 'archives' || archivesLoading) return undefined;
    let alive = true;
    setArchivesLoading(true);
    setArchivesError('');
    loadEventArchives().then(items => {
      if (!alive) return;
      setArchives(items);
      setSelectedArchiveId(current => current && items.some(item => item.id === current) ? current : (items[0]?.id || ''));
    }).catch(error => {
      console.error('Unable to load event archives:', error);
      if (alive) setArchivesError('Unable to load event archives. Deploy the updated Firestore rules and try again.');
    }).finally(() => {
      if (alive) setArchivesLoading(false);
    });
    return () => { alive = false; };
  }, [view]);

  useEffect(() => {
    const zoom = clampZoom(state.zoomFactor);
    document.documentElement.style.setProperty('--app-zoom', String(zoom));
    document.body.style.zoom = String(zoom);
    return () => {
      document.body.style.zoom = '';
      document.documentElement.style.removeProperty('--app-zoom');
    };
  }, [state.zoomFactor]);

  useEffect(() => {
    const listener = event => {
      if (event.key === 'Escape' && dialog) {
        event.preventDefault();
        resolveDialog(false);
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        if (event.key === '+' || event.key === '=') { event.preventDefault(); changeZoom(ZOOM_STEP); }
        else if (event.key === '-' || event.key === '_') { event.preventDefault(); changeZoom(-ZOOM_STEP); }
        else if (event.key === '0') { event.preventDefault(); setZoom(1); }
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  });

  function updateState(updater) {
    setState(current => typeof updater === 'function' ? updater(current) : updater);
  }

  function toast(message) {
    setToastMessage(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMessage(''), 1900);
  }

  function askDialog(options) {
    if (dialogResolver.current) dialogResolver.current(false);
    return new Promise(resolve => {
      dialogResolver.current = resolve;
      setDialog({ showCancel: true, ...options });
    });
  }

  function showConfirm(message, options = {}) {
    return askDialog({ message, showCancel: true, ...options });
  }

  function showNotice(message, options = {}) {
    return askDialog({ message, showCancel: false, confirmText: options.confirmText || 'OK', title: options.title || 'SmashPool', ...options });
  }

  function resolveDialog(result) {
    const resolve = dialogResolver.current;
    dialogResolver.current = null;
    setDialog(null);
    resolve?.(Boolean(result));
  }

  function setZoom(value) {
    const zoom = clampZoom(value);
    updateState(current => ({ ...current, zoomFactor: zoom }));
    toast(`Zoom ${Math.round(zoom * 100)}%`);
  }
  function changeZoom(delta) { setZoom(state.zoomFactor + delta); }

  async function toggleBetting() {
    const currentlyOpen = effectiveBettingOpen(state);
    const nextOpen = !currentlyOpen;
    if (nextOpen && state.settledWinnerId) {
      await showNotice('Undo the final payout before reopening betting.', { title: 'Settlement is finalized' });
      return;
    }
    if (nextOpen && cutoffReached(state.bettingCutoffAt)) {
      await showNotice('The betting cutoff has already passed. Update or clear the cutoff time in Pool Settings before reopening betting.', { title: 'Cutoff reached' });
      return;
    }
    updateState(current => ({ ...current, bettingOpen: nextOpen }));
    toast(nextOpen ? 'Betting reopened' : 'Betting closed');
  }

  async function archiveCurrentEvent() {
    const ok = await showConfirm(`Archive “${state.tournamentName}” exactly as it is now? This creates a permanent historical snapshot and does not reset or modify the live pool.`, { title: 'Archive current event?', confirmText: 'Archive Event' });
    if (!ok) return;
    try {
      const archived = await archiveEvent(state, user?.email || '');
      setArchives(current => [archived, ...current.filter(item => item.id !== archived.id)]);
      setSelectedArchiveId(archived.id);
      setArchivesError('');
      setView('archives');
      toast('Event archived');
    } catch (error) {
      console.error('Unable to archive event:', error);
      await showNotice('The event could not be archived. Make sure the updated Firestore rules are deployed and try again.', { title: 'Archive failed', danger: true });
    }
  }

  function exportTournament() {
    downloadText('smashpool-tournament.json', JSON.stringify(state, null, 2), 'application/json;charset=utf-8');
    toast('Tournament exported');
  }

  async function importTournament(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      let imported = migrateState(parsed);
      const ok = await showConfirm(`Import “${imported.tournamentName}”? This will replace the tournament currently stored in Firebase.`, { title: 'Import tournament?', confirmText: 'Import' });
      if (!ok) return;
      imported = await migrateInlinePhotosToStorage(imported);
      setState(imported);
      setView('dashboard');
      setSettingsOpen(false);
      toast('Tournament imported');
    } catch (error) {
      console.error(error);
      await showNotice('That file is not a valid SmashPool tournament JSON export.', { title: 'Import failed', danger: true });
    }
  }

  async function resetTournament() {
    const ok = await showConfirm('This will reset the entire tournament, including every bet, pair name, profile picture, and setting.', { title: 'Reset tournament?', confirmText: 'Reset Tournament', danger: true });
    if (!ok) return;
    const reset = makeDefaultState();
    reset.zoomFactor = state.zoomFactor;
    setState(reset);
    setSettingsOpen(false);
    setView('dashboard');
    toast('Tournament reset');
  }

  if (!hydrated) {
    return <div className="loading-screen"><div className="brand-mark">S</div><div><strong>SmashPool</strong><span>Loading tournament…</span></div></div>;
  }

  return (
    <>
      <div className="app-shell">
        <aside className={`sidebar ${mobileNavOpen ? 'mobile-open' : ''}`}>
          <div className="brand"><div className="brand-mark">S</div><div><div className="brand-name">SmashPool</div><div className="brand-subtitle">Pari-Mutuel Manager</div></div><button type="button" className="mobile-sidebar-close" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}>×</button></div>
          <nav className="nav" aria-label="Main navigation">
            {[
              ['dashboard','⌂','Dashboard'],
              ['betting','＋','Enter Bets'],
              ['pairs','♟','Pairs & Players'],
              ['bets','≡','Bet Ledger'],
              ['settlement','✓','Settlement'],
              ['archives','▣','Event Archives']
            ].map(([id, icon, label]) => <button className={`nav-item ${view === id ? 'active' : ''}`} key={id} onClick={() => { setView(id); setMobileNavOpen(false); }}><span>{icon}</span>{label}</button>)}
          </nav>
          <div className="sidebar-footer"><div className="status-chip"><span className={`status-dot ${effectiveBettingOpen(state) ? '' : 'closed-dot'}`} /><span>{effectiveBettingOpen(state) ? 'Betting Open' : 'Betting Closed'}</span></div><div className="local-note">Firebase Admin<br />{user?.email || 'Authenticated'}</div></div>
        </aside>
        <button type="button" className={`mobile-nav-backdrop ${mobileNavOpen ? 'show' : ''}`} aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />

        <main className="main">
          <header className="topbar">
            <div className="topbar-title-wrap"><button type="button" className="mobile-nav-toggle" aria-label="Open navigation" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(true)}>☰</button><div><div className="eyebrow">TOURNAMENT POOL</div><h1>{PAGE_TITLES[view]}</h1></div></div>
            <div className="top-actions">
              <div className="zoom-control" aria-label="Interface zoom controls"><button type="button" className="zoom-btn" disabled={state.zoomFactor <= MIN_ZOOM} onClick={() => changeZoom(-ZOOM_STEP)}>−</button><button type="button" className="zoom-value" onClick={() => setZoom(1)}>{Math.round(state.zoomFactor * 100)}%</button><button type="button" className="zoom-btn" disabled={state.zoomFactor >= MAX_ZOOM} onClick={() => changeZoom(ZOOM_STEP)}>+</button></div>
              <input ref={importRef} className="hidden" type="file" accept="application/json,.json" onChange={importTournament} />
              <button className="btn ghost" onClick={() => importRef.current?.click()}>Import</button>
              <button className="btn ghost" onClick={exportTournament}>Export</button>
              <button className="btn secondary archive-action-btn" onClick={archiveCurrentEvent}>Archive Event</button>
              <button className="btn secondary" onClick={() => setSettingsOpen(true)}>Pool Settings</button>
              <button className="btn ghost" onClick={() => signOut(auth)}>Sign Out</button>
              <button className="btn primary" onClick={() => setView('betting')}>+ New Bet</button>
            </div>
          </header>

          <section className="view active">
            {view === 'dashboard' && <Dashboard state={state} onView={setView} onToggleBetting={toggleBetting} />}
            {view === 'betting' && <Betting state={state} updateState={updateState} toast={toast} showNotice={showNotice} />}
            {view === 'pairs' && <Pairs state={state} updateState={updateState} toast={toast} showConfirm={showConfirm} showNotice={showNotice} />}
            {view === 'bets' && <Ledger state={state} updateState={updateState} toast={toast} showConfirm={showConfirm} />}
            {view === 'settlement' && <Settlement state={state} updateState={updateState} toast={toast} showConfirm={showConfirm} showNotice={showNotice} />}
            {view === 'archives' && <EventArchives archives={archives} loading={archivesLoading} error={archivesError} selectedId={selectedArchiveId} onSelect={setSelectedArchiveId} onArchiveCurrent={archiveCurrentEvent} />}
          </section>
        </main>
      </div>

      <SettingsModal open={settingsOpen} state={state} onClose={() => setSettingsOpen(false)} onSave={(name, fee, publicDashboardEnabled, bettingCutoffAt, eventDescriptionHtml) => { updateState(current => ({ ...current, tournamentName: name, feePercent: fee, publicDashboardEnabled, bettingCutoffAt, eventDescriptionHtml })); setSettingsOpen(false); toast(publicDashboardEnabled ? 'Settings saved • Public dashboard enabled' : 'Settings saved • Public dashboard hidden'); }} onReset={resetTournament} />
      <ActionDialog dialog={dialog} onResult={resolveDialog} />
      <div className={`toast ${toastMessage ? 'show' : ''}`}>{toastMessage}</div>
    </>
  );
}

function FirebaseSetupRequired() {
  return <div className="auth-shell">
    <div className="auth-card card">
      <div className="brand auth-brand"><div className="brand-mark">S</div><div><div className="brand-name">SmashPool</div><div className="brand-subtitle">Firebase Setup</div></div></div>
      <div className="eyebrow">CONFIGURATION REQUIRED</div>
      <h2>Connect this build to Firebase</h2>
      <p className="muted">Copy <code>.env.example</code> to <code>.env</code> and paste the Web App configuration values from your Firebase project settings.</p>
      <div className="callout">Missing configuration: {firebaseMissingKeys.join(', ') || 'unknown'}</div>
      <p className="muted small-copy">This build is preconfigured for project ID <strong>smashpool-d6818</strong>, but the remaining Firebase Web App values must come from your own Firebase console.</p>
    </div>
  </div>;
}

function AdminLogin({ authError }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setWorking(true);
    setError('');
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      console.error(err);
      setError('Unable to sign in. Check the email/password and make sure Email/Password authentication is enabled.');
    } finally {
      setWorking(false);
    }
  }

  return <div className="auth-shell">
    <form className="auth-card card" onSubmit={submit}>
      <div className="brand auth-brand"><div className="brand-mark">S</div><div><div className="brand-name">SmashPool</div><div className="brand-subtitle">Administrator</div></div></div>
      <div className="eyebrow">PRIVATE ADMIN</div>
      <h2>Sign in to manage the pool</h2>
      <p className="muted">The public site is read-only. Only approved Firebase admin accounts can change pairs, enter bets, or settle payouts.</p>
      <label>Email<input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} /></label>
      <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label>
      {(error || authError) && <div className="auth-error">{error || authError}</div>}
      <button className="btn primary full" type="submit" disabled={working}>{working ? 'Signing in…' : 'Sign In'}</button>
      <a className="public-link" href="/">← View public dashboard</a>
    </form>
  </div>;
}

function PublicBettorBreakdown({ pair, prizePool }) {
  const bettors = Array.isArray(pair?.bettors) ? pair.bettors : [];
  const pairTotal = Number(pair?.betTotal || 0);
  const currentPrizePool = Number(prizePool || 0);
  return <div className="public-bettor-breakdown">
    <div className="bettor-breakdown-heading">
      <span>ANONYMOUS WAGERS ON THIS PAIR</span>
      <strong>{bettors.length} {bettors.length === 1 ? 'bettor' : 'bettors'} • {currency(pairTotal)}</strong>
    </div>
    {bettors.length ? <div className="bettor-breakdown-list">
      {bettors.map((item, index) => {
        const wager = Number(item.amount || 0);
        const projectedPayout = pairTotal > 0 ? currentPrizePool * (wager / pairTotal) : 0;
        return <div className="bettor-breakdown-item wager-only" key={`anonymous-${index}-${wager}`}>
          <div className="bettor-breakdown-values">
            <div><span>Wager</span><strong className="bettor-breakdown-amount">{currency(wager)}</strong></div>
            <div><span>Projected payout</span><strong className="bettor-breakdown-payout">{currency(projectedPayout)}</strong></div>
          </div>
          {Number(item.betCount || 0) > 1 && <div className="bettor-breakdown-combined">{Number(item.betCount)} bets combined</div>}
        </div>;
      })}
    </div> : <div className="bettor-breakdown-empty">No bets have been placed on this pair yet.</div>}
  </div>;
}

function PublicDashboard({ data }) {
  const pairs = Array.isArray(data?.pairs) ? data.pairs : [];
  const recent = Array.isArray(data?.recentBets) ? data.recentBets : [];
  const leader = pairs.find(pair => pair.id === data?.mostBetOnPairId) || null;
  const [expandedPairs, setExpandedPairs] = useState(() => new Set());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!data?.bettingCutoffAt) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [data?.bettingCutoffAt]);
  const publicBettingOpen = Boolean(data?.bettingOpen) && !cutoffReached(data?.bettingCutoffAt, now);

  const togglePair = pairId => {
    setExpandedPairs(current => {
      const next = new Set(current);
      if (next.has(pairId)) next.delete(pairId);
      else next.add(pairId);
      return next;
    });
  };

  return <div className="public-dashboard">
    <header className="public-topbar">
      <div className="brand"><div className="brand-mark">S</div><div><div className="brand-name">SmashPool</div><div className="brand-subtitle">v{packageInfo.version}</div></div></div>
      <div className="status-chip"><span className={`status-dot ${publicBettingOpen ? '' : 'closed-dot'}`} /><span>{publicBettingOpen ? 'Betting Open' : 'Betting Closed'}</span></div>
    </header>

    <main className="public-main">
      <div className="hero card public-hero">
        <div className="hero-copy">
          <div className="hero-tag-row"><div className="tag">LIVE POOL</div><CutoffCountdown cutoffAt={data?.bettingCutoffAt} /></div>
          <h2>{data?.tournamentName || 'SmashPool Tournament'}</h2>
          <EventDescription html={data?.eventDescriptionHtml} className="public-event-description" />
        </div>
        <div className="hero-orbit" aria-hidden="true"><div className="shuttle">◒</div><div className="orbit-ring ring-a" /><div className="orbit-ring ring-b" /></div>
      </div>

      <div className="stats-grid">
        <article className="stat-card card"><div className="stat-label">Total Pool</div><div className="stat-value">{currency(data?.totalPool)}</div><div className="stat-meta">All accepted bets</div></article>
        <article className="stat-card card"><div className="stat-label">Prize Pool</div><div className="stat-value">{currency(data?.prizePool)}</div><div className="stat-meta">After {Number(data?.feePercent || 0)}% deduction</div></article>
        <article className="stat-card card"><div className="stat-label">Bettors</div><div className="stat-value">{Number(data?.uniqueBettors || 0)}</div><div className="stat-meta">{Number(data?.totalBets || 0)} total bets</div></article>
        <article className="stat-card card market-leader-card">
          <div className="stat-label">Most Bet-On Pair</div>
          <div className="market-leader-value-row">
            {leader && <PairAvatars pair={leader} className="leader-avatars" />}
            <div className="stat-value compact">{leader ? pairName(leader) : '—'}</div>
          </div>
          <div className="stat-meta">{leader ? `${currency(leader.betTotal)} wagered • ${pct(leader.poolShare)} of pool` : 'No bets yet'}</div>
        </article>
      </div>

      <div className="dashboard-grid">
        <section className="card panel wide-panel">
          <div className="panel-header"><div><div className="eyebrow">LIVE MARKET</div><h3>Projected Returns</h3></div><div className="legend"><span className="legend-dot" /> Tap a pair to see wager amounts</div></div>
          <div className="table-wrap public-market-table"><table>
            <thead><tr><th>Pair</th><th>Group</th><th>Bet On Pair</th><th>Bettors</th><th>Pool Share</th><th>Projected Payout (On $5 Bet)</th></tr></thead>
            <tbody>{pairs.length ? pairs.map(pair => {
              const expanded = expandedPairs.has(pair.id);
              return <React.Fragment key={pair.id}>
                <tr className={`expandable-market-row ${expanded ? 'expanded' : ''}`} onClick={() => togglePair(pair.id)} aria-expanded={expanded}>
                  <td className="pair-cell"><div className="pair-identity"><PairAvatars pair={pair} className="market-avatars" /><div><strong>{pairName(pair)}</strong></div><span className="pair-expand-chevron" aria-hidden="true">⌄</span></div></td>
                  <td><GroupBadge group={pair.group} /></td>
                  <td className="money">{currency(pair.betTotal)}</td>
                  <td className="bettor-count">{Number(pair.bettorCount || 0)}</td>
                  <td>{pct(pair.poolShare)}</td>
                  <td className="multiplier">{publicProjectedPayout(data, pair, 5) != null ? currency(publicProjectedPayout(data, pair, 5)) : '—'}</td>
                </tr>
                {expanded && <tr className="bettor-breakdown-row"><td colSpan="6"><PublicBettorBreakdown pair={pair} prizePool={data?.prizePool} /></td></tr>}
              </React.Fragment>;
            }) : <tr><td colSpan="6"><div className="empty-state">No pairs have been published yet.</div></td></tr>}</tbody>
          </table></div>
          <div className="public-market-cards">
            {pairs.length ? pairs.map(pair => {
              const expanded = expandedPairs.has(pair.id);
              return <article className={`public-pair-card ${expanded ? 'expanded' : ''}`} key={pair.id}>
                <button className="public-pair-card-toggle" type="button" onClick={() => togglePair(pair.id)} aria-expanded={expanded}>
                  <div className="public-pair-card-head">
                    <div className="pair-identity"><PairAvatars pair={pair} className="mobile-market-avatars" /><div className="public-pair-names"><strong>{pairName(pair)}</strong></div></div>
                  </div>
                  <div className="public-pair-group-row">
                    <GroupBadge group={pair.group} />
                    <span className="pair-expand-chevron" aria-hidden="true">⌄</span>
                  </div>
                  <div className="public-pair-primary">
                    <div><span>Bet on pair</span><strong className="money">{currency(pair.betTotal)}</strong></div>
                    <div><span>Projected Payout (On $5 Bet)</span><strong className="multiplier">{publicProjectedPayout(data, pair, 5) != null ? currency(publicProjectedPayout(data, pair, 5)) : '—'}</strong></div>
                  </div>
                  <div className="public-pair-metrics">
                    <div><span>Bettors</span><strong>{Number(pair.bettorCount || 0)}</strong></div>
                    <div><span>Pool share</span><strong>{pct(pair.poolShare)}</strong></div>
                  </div>
                  <div className="public-pair-expand-label">{expanded ? 'Hide wager details' : `View ${Number(pair.bettorCount || 0)} anonymous ${Number(pair.bettorCount || 0) === 1 ? 'bettor' : 'bettors'}`}</div>
                </button>
                {expanded && <PublicBettorBreakdown pair={pair} prizePool={data?.prizePool} />}
              </article>;
            }) : <div className="empty-state">No pairs have been published yet.</div>}
          </div>
        </section>

        <section className="card panel activity-panel">
          <div className="panel-header"><div><div className="eyebrow">RECENT</div><h3>Bet Activity</h3></div></div>
          <div className="activity-list">{recent.length ? recent.map(bet => <div className="activity-item" key={bet.id}>
            <div className="activity-avatar">$</div>
            <div className="activity-copy"><strong>Anonymous Bet</strong><span>{bet.group || '?'} • {bet.pairName}</span></div>
            <div className="activity-amount">{currency(bet.amount)}</div>
          </div>) : <div className="empty-mini">No bets yet.</div>}</div>
        </section>
      </div>
    </main>
  </div>;
}

function NoOngoingEvents() {
  return <div className="public-dashboard public-empty-dashboard">
    <header className="public-topbar">
      <div className="brand"><div className="brand-mark">S</div><div><div className="brand-name">SmashPool</div><div className="brand-subtitle">Pari-Mutuel Dashboard</div></div></div>
    </header>
    <main className="public-empty-main">
      <section className="card public-empty-card">
        <div className="public-empty-icon" aria-hidden="true">◇</div>
        <div className="eyebrow">SMASHPOOL</div>
        <h1>No Ongoing Events</h1>
        <p>There is no active event available for public viewing right now.</p>
        <span>Please check back when the next event is live.</span>
      </section>
    </main>
  </div>;
}

function PublicApp() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!firebaseReady) return undefined;
    return listenPublicDashboard(snapshot => {
      setData(snapshot);
      setLoading(false);
      setError('');
    }, err => {
      console.error(err);
      setError('Unable to load the live dashboard. Check the Firestore security rules and Firebase configuration.');
      setLoading(false);
    });
  }, []);

  if (!firebaseReady) return <FirebaseSetupRequired />;
  if (loading) return <div className="loading-screen"><div className="brand-mark">S</div><div><strong>SmashPool</strong><span>Connecting to live dashboard…</span></div></div>;
  if (error) return <div className="auth-shell"><div className="auth-card card"><h2>Dashboard unavailable</h2><div className="auth-error">{error}</div></div></div>;
  if (data?.publicDashboardEnabled === false) return <NoOngoingEvents />;
  if (!data) return <div className="auth-shell"><div className="auth-card card"><div className="brand auth-brand"><div className="brand-mark">S</div><div><div className="brand-name">SmashPool</div><div className="brand-subtitle">Live Dashboard</div></div></div><h2>No tournament published yet</h2><p className="muted">Sign in to the admin interface once to initialize the Firebase pool.</p></div></div>;
  return <PublicDashboard data={data} />;
}

function AdminGate() {
  const [checking, setChecking] = useState(true);
  const [adminUser, setAdminUser] = useState(null);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    if (!firebaseReady || !auth) {
      setChecking(false);
      return undefined;
    }
    return onAuthStateChanged(auth, async user => {
      setChecking(true);
      setAuthError('');
      if (!user) {
        setAdminUser(null);
        setChecking(false);
        return;
      }
      try {
        const allowed = await isAdminUser(user.uid);
        if (!allowed) {
          await signOut(auth);
          setAdminUser(null);
          setAuthError('This Firebase account is not listed as a SmashPool administrator.');
        } else {
          setAdminUser(user);
        }
      } catch (error) {
        console.error(error);
        setAdminUser(null);
        setAuthError('Unable to verify administrator access. Check your Firestore rules and admins document.');
      } finally {
        setChecking(false);
      }
    });
  }, []);

  if (!firebaseReady) return <FirebaseSetupRequired />;
  if (checking) return <div className="loading-screen"><div className="brand-mark">S</div><div><strong>SmashPool Admin</strong><span>Checking access…</span></div></div>;
  if (!adminUser) return <AdminLogin authError={authError} />;
  return <AdminApp user={adminUser} />;
}

export default function App() {
  const isAdminRoute = window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/');
  return isAdminRoute ? <AdminGate /> : <PublicApp />;
}
