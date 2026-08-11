const GROUPS = ['Advantage', 'Challenge'];

const defaultPairs = [
  { id: 'p1', group: 'Advantage', player1: 'Pair 1A', player2: 'Pair 1B', player1Photo: null, player2Photo: null },
  { id: 'p2', group: 'Advantage', player1: 'Pair 2A', player2: 'Pair 2B', player1Photo: null, player2Photo: null },
  { id: 'p3', group: 'Advantage', player1: 'Pair 3A', player2: 'Pair 3B', player1Photo: null, player2Photo: null },
  { id: 'p4', group: 'Advantage', player1: 'Pair 4A', player2: 'Pair 4B', player1Photo: null, player2Photo: null },
  { id: 'p5', group: 'Advantage', player1: 'Pair 5A', player2: 'Pair 5B', player1Photo: null, player2Photo: null },
  { id: 'p6', group: 'Challenge', player1: 'Pair 6A', player2: 'Pair 6B', player1Photo: null, player2Photo: null },
  { id: 'p7', group: 'Challenge', player1: 'Pair 7A', player2: 'Pair 7B', player1Photo: null, player2Photo: null },
  { id: 'p8', group: 'Challenge', player1: 'Pair 8A', player2: 'Pair 8B', player1Photo: null, player2Photo: null },
  { id: 'p9', group: 'Challenge', player1: 'Pair 9A', player2: 'Pair 9B', player1Photo: null, player2Photo: null },
  { id: 'p10', group: 'Challenge', player1: 'Pair 10A', player2: 'Pair 10B', player1Photo: null, player2Photo: null }
];

const makeDefaultState = () => ({
  tournamentName: 'Badminton Championship Pool',
  feePercent: 0,
  bettingOpen: true,
  settledWinnerId: null,
  preSettlementBettingOpen: null,
  zoomFactor: 1,
  pairs: structuredClone(defaultPairs),
  bets: []
});

let state = makeDefaultState();
let settlementPreview = null;
let persistChain = Promise.resolve();
let betSubmissionPending = false;
let actionDialogResolve = null;
let actionDialogLastFocus = null;
let draggedPairId = null;
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function currency(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n || 0));
}
function pct(n) { return `${Number(n || 0).toFixed(1)}%`; }
function pairName(pair) { return `${pair.player1} / ${pair.player2}`; }
function normalizeGroup(group) { return group === 'Challenge' || group === 'B' ? 'Challenge' : 'Advantage'; }
function groupOrder(group) { return normalizeGroup(group) === 'Advantage' ? 0 : 1; }
function getPair(id) { return state.pairs.find(p => p.id === id); }
function totalPool() { return state.bets.reduce((s,b) => s + Number(b.amount), 0); }
function prizePool() { return totalPool() * (1 - Number(state.feePercent || 0) / 100); }
function totalOnPair(id) { return state.bets.filter(b => b.pairId === id).reduce((s,b) => s + Number(b.amount), 0); }
function bettorsOnPair(id) {
  return new Set(
    state.bets
      .filter(b => b.pairId === id)
      .map(b => String(b.bettor || '').trim().toLowerCase())
      .filter(Boolean)
  ).size;
}
function pairMultiplier(id, prospectiveAmount = 0) {
  const currentTotal = totalPool();
  const currentPair = totalOnPair(id);
  const nextPool = currentTotal + prospectiveAmount;
  const nextPair = currentPair + prospectiveAmount;
  if (nextPair <= 0 || nextPool <= 0) return null;
  const nextPrize = nextPool * (1 - Number(state.feePercent || 0) / 100);
  return nextPrize / nextPair;
}

const MIN_ZOOM = 0.7;
const MAX_ZOOM = 1.5;
const ZOOM_STEP = 0.1;

function clampZoom(value) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((Number(value) || 1) * 10) / 10));
}

function playerInitials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return parts.slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

function safePhotoSrc(value) {
  const src = typeof value === 'string' ? value : '';
  return /^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(src) ? src : '';
}

function avatarMarkup(name, photo, extraClass = '') {
  const src = safePhotoSrc(photo);
  const className = `player-avatar${extraClass ? ` ${extraClass}` : ''}`;
  if (src) return `<span class="${className}"><img src="${src}" alt=""></span>`;
  return `<span class="${className}"><span>${escapeHtml(playerInitials(name))}</span></span>`;
}

function pairAvatarsMarkup(pair, extraClass = '') {
  return `<span class="pair-avatars${extraClass ? ` ${extraClass}` : ''}">${avatarMarkup(pair.player1, pair.player1Photo)}${avatarMarkup(pair.player2, pair.player2Photo)}</span>`;
}

async function resizeProfilePhoto(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error('Please choose an image file.');
  if (file.size > 12 * 1024 * 1024) throw new Error('Please choose an image smaller than 12 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    const size = Math.min(bitmap.width, bitmap.height);
    const sx = Math.max(0, (bitmap.width - size) / 2);
    const sy = Math.max(0, (bitmap.height - size) / 2);
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 320;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#0a1828';
    ctx.fillRect(0, 0, 320, 320);
    ctx.drawImage(bitmap, sx, sy, size, size, 0, 0, 320, 320);
    return canvas.toDataURL('image/webp', 0.84);
  } finally {
    bitmap.close?.();
  }
}

async function applyZoom(value, { save = true, notify = false } = {}) {
  const zoom = clampZoom(value);
  state.zoomFactor = zoom;
  const result = await window.poolAPI.setZoomFactor(zoom);
  const applied = clampZoom(result?.zoom ?? zoom);
  state.zoomFactor = applied;
  const label = $('#zoomLabel');
  if (label) label.textContent = `${Math.round(applied * 100)}%`;
  $('#zoomOutBtn')?.toggleAttribute('disabled', applied <= MIN_ZOOM);
  $('#zoomInBtn')?.toggleAttribute('disabled', applied >= MAX_ZOOM);
  if (save) await persist();
  if (notify) toast(`Zoom ${Math.round(applied * 100)}%`);
}

function persist() {
  // Serialize saves so fast actions (delete/toggle/add) cannot write stale state
  // over a newer state on slower disks or Windows file systems.
  const snapshot = structuredClone(state);
  persistChain = persistChain
    .catch(() => undefined)
    .then(() => window.poolAPI.saveState(snapshot));
  return persistChain;
}

function syncBetEntryState() {
  const open = Boolean(state.bettingOpen);
  const interactive = open && !betSubmissionPending;
  const form = $('#betForm');
  if (!form) return;

  // Explicitly restore every betting control after a close/reopen or full render.
  // Setting both the property and attribute state avoids a stale disabled control.
  form.querySelectorAll('input, select, button').forEach(control => {
    control.disabled = !interactive;
    if (interactive) control.removeAttribute('disabled');
    else control.setAttribute('disabled', '');
  });

  const submit = $('#submitBetBtn');
  submit.textContent = !open ? 'Betting is Closed' : (betSubmissionPending ? 'Saving Bet…' : 'Add Bet to Pool');
  submit.setAttribute('aria-disabled', interactive ? 'false' : 'true');
}

async function setBettingOpen(open) {
  state.bettingOpen = Boolean(open);
  try {
    await persist();
  } catch (error) {
    console.error('Unable to save betting status:', error);
    toast('Could not save pool status');
  }
  renderAll();
}


function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1900);
}

function closeActionDialog(result) {
  const modal = $('#actionDialog');
  if (!modal || modal.classList.contains('hidden')) return;
  modal.classList.add('hidden');
  const resolve = actionDialogResolve;
  actionDialogResolve = null;

  // Restore renderer focus before the caller mutates/re-renders the UI. This
  // avoids the native confirm()/alert() focus handoff bug seen on Windows.
  const previous = actionDialogLastFocus;
  actionDialogLastFocus = null;
  if (previous && previous.isConnected && typeof previous.focus === 'function') {
    previous.focus({ preventScroll: true });
  } else {
    document.body.focus?.();
  }
  if (resolve) resolve(Boolean(result));
}

function showActionDialog({
  title = 'Confirm action',
  message = '',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  showCancel = true,
  danger = false,
  eyebrow = 'CONFIRM ACTION'
} = {}) {
  // Never stack dialogs. Resolve an older one as cancelled first.
  if (actionDialogResolve) closeActionDialog(false);

  const modal = $('#actionDialog');
  const confirmBtn = $('#actionDialogConfirm');
  const cancelBtn = $('#actionDialogCancel');
  const icon = $('#actionDialogIcon');
  actionDialogLastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  $('#actionDialogTitle').textContent = title;
  $('#actionDialogMessage').textContent = message;
  $('#actionDialogEyebrow').textContent = eyebrow;
  confirmBtn.textContent = confirmText;
  cancelBtn.textContent = cancelText;
  cancelBtn.classList.toggle('hidden', !showCancel);
  confirmBtn.classList.toggle('dialog-danger', danger);
  icon.classList.toggle('danger', danger);
  icon.textContent = danger ? '!' : (showCancel ? '?' : 'i');
  modal.classList.remove('hidden');

  return new Promise(resolve => {
    actionDialogResolve = resolve;
    requestAnimationFrame(() => {
      // For destructive operations, default focus to Cancel; for notices, OK.
      (showCancel ? cancelBtn : confirmBtn).focus({ preventScroll: true });
    });
  });
}

function showConfirm(message, options = {}) {
  return showActionDialog({ message, ...options, showCancel: true });
}

function showNotice(message, options = {}) {
  return showActionDialog({
    title: options.title || 'SmashPool',
    message,
    confirmText: options.confirmText || 'OK',
    showCancel: false,
    danger: Boolean(options.danger),
    eyebrow: options.eyebrow || 'NOTICE'
  });
}

function setView(view) {
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
  const labels = { dashboard:'Dashboard', betting:'Enter Bets', pairs:'Pairs & Players', bets:'Bet Ledger', settlement:'Settlement' };
  $('#pageTitle').textContent = labels[view];
}

function renderAll() {
  const zoomLabel = $('#zoomLabel');
  if (zoomLabel) zoomLabel.textContent = `${Math.round(clampZoom(state.zoomFactor) * 100)}%`;
  $('#zoomOutBtn')?.toggleAttribute('disabled', clampZoom(state.zoomFactor) <= MIN_ZOOM);
  $('#zoomInBtn')?.toggleAttribute('disabled', clampZoom(state.zoomFactor) >= MAX_ZOOM);
  renderStatus();
  renderSummary();
  renderMarket();
  renderActivity();
  renderPairSelectors();
  renderBetPreview();
  renderPairBoard();
  renderPairEditors();
  renderLedger();
  renderSettlement();
}

function renderStatus() {
  $('#sidebarStatus').textContent = state.bettingOpen ? 'Betting Open' : 'Betting Closed';
  const dot = $('.status-dot');
  dot.style.background = state.bettingOpen ? 'var(--success)' : 'var(--danger)';
  dot.style.boxShadow = `0 0 12px ${state.bettingOpen ? 'var(--success)' : 'var(--danger)'}`;
  $('#toggleBettingBtn').textContent = state.bettingOpen ? 'Close Betting' : 'Reopen Betting';
  $('#bettingPill').textContent = state.bettingOpen ? 'OPEN' : 'CLOSED';
  $('#bettingPill').className = `pill ${state.bettingOpen ? 'open' : 'closed'}`;
  syncBetEntryState();
}

function renderSummary() {
  $('#tournamentNameHero').textContent = state.tournamentName;
  const total = totalPool();
  const prize = prizePool();
  const bettors = new Set(state.bets.map(b => b.bettor.toLowerCase())).size;
  $('#statTotalPool').textContent = currency(total);
  $('#statPrizePool').textContent = currency(prize);
  $('#statFeeMeta').textContent = `After ${state.feePercent}% deduction`;
  $('#statBettors').textContent = bettors;
  $('#statBetCount').textContent = state.bets.length;
  const totals = state.pairs.map(p => ({ pair:p, total:totalOnPair(p.id) })).sort((a,b)=>b.total-a.total);
  if (totals[0]?.total > 0) {
    $('#statMarketLeaderAvatars').innerHTML = pairAvatarsMarkup(totals[0].pair, 'leader-avatars');
    $('#statMarketLeader').textContent = pairName(totals[0].pair);
    $('#statMarketLeaderMeta').textContent = `${currency(totals[0].total)} wagered • ${pct(totals[0].total/total*100)} of pool`;
  } else {
    $('#statMarketLeaderAvatars').innerHTML = '';
    $('#statMarketLeader').textContent = '—'; $('#statMarketLeaderMeta').textContent = 'No bets yet';
  }
}

function renderMarket() {
  const total = totalPool();
  const originalOrder = new Map(state.pairs.map((pair, index) => [pair.id, index]));
  const sortedPairs = state.pairs.slice().sort((a, b) => {
    const wagerDifference = totalOnPair(b.id) - totalOnPair(a.id);
    if (wagerDifference !== 0) return wagerDifference;
    return originalOrder.get(a.id) - originalOrder.get(b.id);
  });

  $('#marketTableBody').innerHTML = sortedPairs.length ? sortedPairs.map(p => {
    const onPair = totalOnPair(p.id);
    const share = total ? onPair / total * 100 : 0;
    const bettorCount = bettorsOnPair(p.id);
    const mult = pairMultiplier(p.id);
    const twenty = mult ? 20 * mult : 0;
    return `<tr>
      <td class="pair-cell"><div class="pair-identity">${pairAvatarsMarkup(p, 'market-avatars')}<div><strong>${escapeHtml(pairName(p))}</strong><span>${escapeHtml(p.player1)} + ${escapeHtml(p.player2)}</span></div></div></td>
      <td><span class="group-badge ${p.group === 'Challenge' ? 'challenge' : 'advantage'}">${escapeHtml(p.group)}</span></td><td class="money">${currency(onPair)}</td><td class="bettor-count">${bettorCount}</td><td>${pct(share)}</td>
      <td class="multiplier">${mult ? `${mult.toFixed(2)}×` : '—'}</td><td class="money">${mult ? currency(twenty) : '—'}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="7"><div class="empty-state">No pairs yet. Add a pair from Pairs & Players.</div></td></tr>';
}

function renderActivity() {
  const list = state.bets.slice().reverse().slice(0,10);
  $('#recentActivity').innerHTML = list.length ? list.map(b => {
    const p = getPair(b.pairId); const initials = b.bettor.trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
    return `<div class="activity-item"><div class="activity-avatar">${escapeHtml(initials || '?')}</div><div class="activity-copy"><strong>${escapeHtml(b.bettor)}</strong><span>${escapeHtml(p?.group || '?')} • ${escapeHtml(p ? pairName(p) : 'Unknown Pair')}</span></div><div class="activity-amount">${currency(b.amount)}</div></div>`;
  }).join('') : '<div class="empty-mini">No bets yet. Enter the first wager to start the market.</div>';
}

function renderPairSelectors() {
  const pairs = state.pairs.slice().sort((a, b) => groupOrder(a.group) - groupOrder(b.group));
  const selectedBet = $('#betPair').value;
  const selectedWinner = $('#winnerSelect').value;
  const groupedOptions = GROUPS.map(group => {
    const items = pairs.filter(p => p.group === group);
    if (!items.length) return '';
    return `<optgroup label="${group}">${items.map(p => `<option value="${p.id}">${escapeHtml(pairName(p))}</option>`).join('')}</optgroup>`;
  }).join('');
  $('#betPair').innerHTML = `<option value="">Choose a pair...</option>${groupedOptions}`;
  $('#winnerSelect').innerHTML = `<option value="">Choose winning pair...</option>${groupedOptions}`;
  if (pairs.some(p=>p.id===selectedBet)) $('#betPair').value = selectedBet;
  if (pairs.some(p=>p.id===selectedWinner)) $('#winnerSelect').value = selectedWinner;
  if (state.settledWinnerId && pairs.some(p=>p.id===state.settledWinnerId)) $('#winnerSelect').value = state.settledWinnerId;
}

function renderBetPreview() {
  const pairId = $('#betPair').value;
  const amount = Number($('#betAmount').value || 0);
  const pair = getPair(pairId);
  const rows = $$('#betPreview strong');
  if (!pair || amount <= 0) { rows[0].textContent = pair ? pair.group : '—'; rows[1].textContent = '—'; rows[2].textContent = '—'; return; }
  const mult = pairMultiplier(pairId, amount);
  rows[0].textContent = `${pair.group} • ${currency(totalOnPair(pairId))} wagered`;
  rows[1].textContent = mult ? `${mult.toFixed(2)}×` : '—';
  rows[2].textContent = mult ? currency(amount * mult) : '—';
}

function renderPairBoard() {
  $('#betPairBoard').innerHTML = state.pairs.length ? state.pairs.map(p => {
    const onPair = totalOnPair(p.id); const mult = pairMultiplier(p.id);
    return `<div class="pair-tile" data-pair-id="${p.id}"><div class="pair-tile-top"><div class="pair-tile-identity">${pairAvatarsMarkup(p, 'board-avatars')}<div><h4>${escapeHtml(pairName(p))}</h4><small>${escapeHtml(p.group)}</small></div></div></div><div class="pair-tile-bottom"><div><span>WAGERED</span><strong>${currency(onPair)}</strong></div><div><span>CURRENT RETURN</span><strong class="multiplier">${mult ? `${mult.toFixed(2)}×` : '—'}</strong></div></div></div>`;
  }).join('') : '<div class="empty-state">No pairs yet. Add one from Pairs & Players.</div>';
  $$('.pair-tile').forEach(tile => tile.addEventListener('click', () => { $('#betPair').value = tile.dataset.pairId; renderBetPreview(); }));
}

function renderPairEditors() {
  const targets = {
    Advantage: $('#advantageEditor'),
    Challenge: $('#challengeEditor')
  };

  for (const group of GROUPS) {
    const pairs = state.pairs.filter(p => p.group === group);
    const target = targets[group];
    if (!target) continue;
    target.innerHTML = pairs.length ? pairs.map(p=>`
      <div class="pair-editor" data-id="${p.id}">
        <div class="pair-editor-toolbar">
          <div class="drag-handle" draggable="true" title="Drag to move this pair"><span class="drag-dots">⋮⋮</span><span>Drag pair</span></div>
          <span class="group-badge ${group === 'Challenge' ? 'challenge' : 'advantage'}">${group}</span>
          <button type="button" class="delete-pair icon-mini" data-pair-id="${p.id}" title="Delete pair" aria-label="Delete ${escapeAttr(pairName(p))}">×</button>
        </div>
        ${playerEditorMarkup(p, 1)}
        ${playerEditorMarkup(p, 2)}
      </div>`).join('') : `<div class="drop-empty">Drop pairs here or add a new pair.</div>`;
  }

  const advantageCount = state.pairs.filter(p=>p.group==='Advantage').length;
  const challengeCount = state.pairs.filter(p=>p.group==='Challenge').length;
  $('#advantageCount').textContent = `${advantageCount} pair${advantageCount===1?'':'s'}`;
  $('#challengeCount').textContent = `${challengeCount} pair${challengeCount===1?'':'s'}`;

  $$('.photo-picker').forEach(button => button.addEventListener('click', () => {
    const row = button.closest('.player-editor-row');
    row?.querySelector('.photo-input')?.click();
  }));

  $$('.photo-input').forEach(input => input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    const pair = getPair(input.dataset.pairId);
    const player = Number(input.dataset.player);
    if (!pair || ![1,2].includes(player)) return;
    syncPairEditsFromDom();
    const picker = input.closest('.player-editor-row')?.querySelector('.photo-picker');
    if (picker) picker.classList.add('loading');
    try {
      const photo = await resizeProfilePhoto(file);
      pair[`player${player}Photo`] = photo;
      await persist();
      renderAll();
      toast('Profile picture saved');
    } catch (error) {
      console.error('Unable to load profile picture:', error);
      await showNotice(error?.message || 'That image could not be loaded. Try a JPG, PNG, or WebP image.', { title: 'Profile picture' });
    } finally {
      if (picker) picker.classList.remove('loading');
      input.value = '';
    }
  }));

  $$('.remove-photo').forEach(button => button.addEventListener('click', async () => {
    const pair = getPair(button.dataset.pairId);
    const player = Number(button.dataset.player);
    if (!pair || ![1,2].includes(player)) return;
    syncPairEditsFromDom();
    pair[`player${player}Photo`] = null;
    await persist();
    renderAll();
    toast('Profile picture removed');
  }));

  $$('.delete-pair').forEach(button => button.addEventListener('click', async () => {
    await deletePair(button.dataset.pairId);
  }));

  $$('.drag-handle').forEach(handle => {
    const card = handle.closest('.pair-editor');
    handle.addEventListener('dragstart', e => {
      syncPairEditsFromDom();
      draggedPairId = card?.dataset.id || null;
      card?.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      if (draggedPairId) e.dataTransfer.setData('text/plain', draggedPairId);
    });
    handle.addEventListener('dragend', () => {
      draggedPairId = null;
      card?.classList.remove('dragging');
      $$('.pair-drop-zone').forEach(zone => zone.classList.remove('drag-over'));
    });
  });

  $$('.pair-drop-zone').forEach(zone => {
    zone.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', e => {
      if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
    });
    zone.addEventListener('drop', async e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const pairId = draggedPairId || e.dataTransfer.getData('text/plain');
      const targetGroup = normalizeGroup(zone.dataset.group);
      const pair = getPair(pairId);
      if (!pair || pair.group === targetGroup) return;
      syncPairEditsFromDom();
      movePairToGroup(pairId, targetGroup);
      draggedPairId = null;
      await persist();
      renderAll();
      toast(`Pair moved to ${targetGroup}`);
    });
  });
}

function playerEditorMarkup(pair, player) {
  const name = pair[`player${player}`];
  const photo = pair[`player${player}Photo`];
  const editClass = player === 1 ? 'edit-p1' : 'edit-p2';
  return `<div class="player-editor-row">
    <button type="button" class="photo-picker" data-pair-id="${pair.id}" data-player="${player}" title="Add or change ${escapeAttr(name)} profile picture">
      ${avatarMarkup(name, photo, 'editor-avatar')}<span class="photo-edit-badge">${safePhotoSrc(photo) ? '✎' : '+'}</span>
    </button>
    <label class="player-name-field"><span>PLAYER ${player}</span><input class="${editClass}" value="${escapeAttr(name)}" maxlength="40"></label>
    <button type="button" class="remove-photo icon-mini${safePhotoSrc(photo) ? '' : ' hidden'}" data-pair-id="${pair.id}" data-player="${player}" title="Remove profile picture" aria-label="Remove profile picture">×</button>
    <input type="file" class="photo-input hidden" data-pair-id="${pair.id}" data-player="${player}" accept="image/png,image/jpeg,image/webp,image/gif">
  </div>`;
}

function renderLedger() {
  const q = $('#ledgerSearch').value?.trim().toLowerCase() || '';
  const rows = state.bets.slice().reverse().filter(b => {
    const p=getPair(b.pairId); return !q || b.bettor.toLowerCase().includes(q) || (p && pairName(p).toLowerCase().includes(q));
  });
  $('#ledgerBody').innerHTML = rows.length ? rows.map(b=>{const p=getPair(b.pairId);return `<tr><td>${new Date(b.createdAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}</td><td><strong>${escapeHtml(b.bettor)}</strong></td><td>${escapeHtml(p?pairName(p):'Unknown')}</td><td>${p ? `<span class="group-badge ${p.group === 'Challenge' ? 'challenge' : 'advantage'}">${escapeHtml(p.group)}</span>` : '?'}</td><td class="money">${currency(b.amount)}</td><td><button class="delete-bet" data-id="${b.id}" title="Delete bet">×</button></td></tr>`}).join('') : '<tr><td colspan="6"><div class="empty-state">No matching bets.</div></td></tr>';
  $$('.delete-bet').forEach(btn=>btn.addEventListener('click', async()=>{
    if(!(await showConfirm('Delete this bet from the ledger?', { title: 'Delete bet?', confirmText: 'Delete Bet', danger: true }))) return;
    const id = btn.dataset.id;
    const previousBets = state.bets;
    state.bets = state.bets.filter(b=>b.id!==id);
    state.settledWinnerId = null;
    state.preSettlementBettingOpen = null;
    settlementPreview = null;
    try {
      await persist();
      renderAll();
      // A ledger change must never alter whether new wagers can be entered.
      syncBetEntryState();
      toast('Bet removed');
    } catch (error) {
      console.error('Unable to delete bet:', error);
      state.bets = previousBets;
      renderAll();
      toast('Bet could not be removed');
    }
  }));
}

function calculateSettlement(pairId) {
  const winnerBets = state.bets.filter(b=>b.pairId===pairId);
  const winnerTotal = winnerBets.reduce((s,b)=>s+Number(b.amount),0);
  const prize = prizePool();
  const payouts = winnerBets.map(b=>{
    const share = winnerTotal ? Number(b.amount)/winnerTotal : 0;
    const payout = prize*share;
    return { ...b, share, payout, profit:payout-Number(b.amount) };
  });
  return { pairId, winnerTotal, prize, payouts };
}

function renderSettlement() {
  const finalized = Boolean(state.settledWinnerId);
  const winnerSelect = $('#winnerSelect');
  const settleBtn = $('#settleBtn');
  const undoBtn = $('#undoSettlementBtn');

  // A finalized settlement is intentionally locked until it is explicitly undone.
  // This prevents changing the winner while the UI still claims the payout is FINAL.
  winnerSelect.disabled = finalized;
  settleBtn.disabled = finalized;
  settleBtn.textContent = finalized ? 'Final Payouts Calculated' : 'Calculate Final Payouts';
  undoBtn.classList.toggle('hidden', !finalized);

  const pairId = state.settledWinnerId || winnerSelect.value || '';
  const calc = pairId ? calculateSettlement(pairId) : null;
  const pair = getPair(pairId);
  $('#settlementSummary').innerHTML = `<div class="summary-line"><span>Total Pool</span><strong>${currency(totalPool())}</strong></div><div class="summary-line"><span>Deduction (${state.feePercent}%)</span><strong>${currency(totalPool()-prizePool())}</strong></div><div class="summary-line"><span>Prize Pool</span><strong>${currency(prizePool())}</strong></div><div class="summary-line"><span>Winning Pair Bets</span><strong>${calc?currency(calc.winnerTotal):'—'}</strong></div>`;

  if (!calc || !pair) {
    $('#payoutBody').innerHTML='<tr><td colspan="5"><div class="empty-state">Select a winning pair to preview payouts.</div></td></tr>';
    $('#noWinnerBets').classList.add('hidden');
    $('#settlementStatePill').textContent = 'PREVIEW';
    $('#settlementStatePill').className = 'pill';
    return;
  }

  $('#noWinnerBets').classList.toggle('hidden', calc.payouts.length>0);
  $('#payoutBody').innerHTML = calc.payouts.length ? calc.payouts.map(x=>`<tr><td>${escapeHtml(x.bettor)}</td><td>${currency(x.amount)}</td><td>${pct(x.share*100)}</td><td class="money"><strong>${currency(x.payout)}</strong></td><td class="profit-positive">+${currency(Math.max(0,x.profit))}</td></tr>`).join('') : '';
  $('#settlementStatePill').textContent = finalized ? 'FINAL' : 'PREVIEW';
  $('#settlementStatePill').className = `pill ${finalized?'open':''}`;
}

function syncPairEditsFromDom() {
  $$('.pair-editor').forEach(row => {
    const pair = getPair(row.dataset.id);
    if (!pair) return;
    const p1 = row.querySelector('.edit-p1')?.value.trim();
    const p2 = row.querySelector('.edit-p2')?.value.trim();
    if (p1) pair.player1 = p1;
    if (p2) pair.player2 = p2;
  });
}

async function savePairEdits() {
  const edits = [...$$('.pair-editor')].map(row=>({ id:row.dataset.id, player1:row.querySelector('.edit-p1').value.trim(), player2:row.querySelector('.edit-p2').value.trim() }));
  if (edits.some(e=>!e.player1||!e.player2)) { await showNotice('Each pair needs two player names.', { title: 'Missing player name' }); return false; }
  state.pairs = state.pairs.map(p => ({ ...p, ...(edits.find(e=>e.id===p.id) || {}) }));
  return true;
}

function nextPairNumber() {
  const used = state.pairs.map(p => {
    const matches = `${p.player1} ${p.player2}`.match(/Pair\s+(\d+)/i);
    return matches ? Number(matches[1]) : 0;
  });
  return Math.max(state.pairs.length, ...used, 0) + 1;
}

function insertPairIntoGroup(pair, group) {
  pair.group = normalizeGroup(group);
  const lastTargetIndex = state.pairs.reduce((last, item, index) => item.group === pair.group ? index : last, -1);
  if (lastTargetIndex >= 0) state.pairs.splice(lastTargetIndex + 1, 0, pair);
  else if (pair.group === 'Advantage') state.pairs.unshift(pair);
  else state.pairs.push(pair);
}

function movePairToGroup(pairId, group) {
  const index = state.pairs.findIndex(p => p.id === pairId);
  if (index < 0) return;
  const [pair] = state.pairs.splice(index, 1);
  insertPairIntoGroup(pair, group);
}

async function addPair(group) {
  syncPairEditsFromDom();
  const n = nextPairNumber();
  const pair = {
    id: crypto.randomUUID(),
    group: normalizeGroup(group),
    player1: `Pair ${n}A`,
    player2: `Pair ${n}B`,
    player1Photo: null,
    player2Photo: null
  };
  insertPairIntoGroup(pair, pair.group);
  await persist();
  renderAll();
  toast(`Pair added to ${pair.group}`);
}

async function deletePair(pairId) {
  syncPairEditsFromDom();
  const pair = getPair(pairId);
  if (!pair) return;
  const linkedBets = state.bets.filter(b => b.pairId === pairId);
  const settlementAffected = Boolean(state.settledWinnerId) && (state.settledWinnerId === pairId || linkedBets.length > 0);
  const betWarning = linkedBets.length ? ` This will also permanently remove ${linkedBets.length} bet${linkedBets.length === 1 ? '' : 's'} totaling ${currency(linkedBets.reduce((sum,b)=>sum+Number(b.amount),0))}.` : '';
  const settlementWarning = settlementAffected ? ' The finalized payout will be undone because the pool is changing.' : '';
  const ok = await showConfirm(`Delete ${pairName(pair)} from ${pair.group}?${betWarning}${settlementWarning}`, {
    title: 'Delete pair?',
    confirmText: 'Delete Pair',
    danger: true
  });
  if (!ok) return;

  state.pairs = state.pairs.filter(p => p.id !== pairId);
  if (linkedBets.length) state.bets = state.bets.filter(b => b.pairId !== pairId);
  if (settlementAffected || state.settledWinnerId === pairId) {
    const restoreOpen = typeof state.preSettlementBettingOpen === 'boolean' ? state.preSettlementBettingOpen : state.bettingOpen;
    state.settledWinnerId = null;
    state.preSettlementBettingOpen = null;
    state.bettingOpen = restoreOpen;
    settlementPreview = null;
  }
  await persist();
  renderAll();
  toast('Pair deleted');
}

function settlementCsv() {
  const pairId = $('#winnerSelect').value || state.settledWinnerId;
  if (!pairId) return null;
  const pair=getPair(pairId); const calc=calculateSettlement(pairId);
  const esc=v=>`"${String(v).replaceAll('"','""')}"`;
  const header=['Tournament','Winning Pair','Group','Bettor','Winning Bet','Share','Total Return','Profit'];
  const lines=calc.payouts.map(x=>[state.tournamentName,pairName(pair),pair.group,x.bettor,x.amount,(x.share*100).toFixed(2)+'%',x.payout.toFixed(2),x.profit.toFixed(2)]);
  return [header,...lines].map(r=>r.map(esc).join(',')).join('\n');
}

function escapeHtml(value='') { return String(value).replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[ch])); }
function escapeAttr(value='') { return escapeHtml(value); }

function bindEvents() {
  $$('.nav-item').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
  $('#zoomOutBtn').addEventListener('click',()=>applyZoom(state.zoomFactor - ZOOM_STEP, { notify: true }));
  $('#zoomInBtn').addEventListener('click',()=>applyZoom(state.zoomFactor + ZOOM_STEP, { notify: true }));
  $('#zoomResetBtn').addEventListener('click',()=>applyZoom(1, { notify: true }));
  $('#actionDialogConfirm').addEventListener('click',()=>closeActionDialog(true));
  $('#actionDialogCancel').addEventListener('click',()=>closeActionDialog(false));
  $('#actionDialog').addEventListener('click',e=>{if(e.target.id==='actionDialog')closeActionDialog(false);});
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape' && !$('#actionDialog').classList.contains('hidden')) {
      e.preventDefault();
      closeActionDialog(false);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      if (e.key === '+' || e.key === '=') { e.preventDefault(); applyZoom(state.zoomFactor + ZOOM_STEP, { notify: true }); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); applyZoom(state.zoomFactor - ZOOM_STEP, { notify: true }); }
      else if (e.key === '0') { e.preventDefault(); applyZoom(1, { notify: true }); }
    }
  });
  $('#quickBetBtn').addEventListener('click',()=>setView('betting'));
  $('#heroBetBtn').addEventListener('click',()=>setView('betting'));
  $('#betPair').addEventListener('change',renderBetPreview);
  $('#betAmount').addEventListener('input',renderBetPreview);
  $$('.quick-amounts button').forEach(b=>b.addEventListener('click',()=>{$('#betAmount').value=b.dataset.amount;renderBetPreview();}));
  $('#betForm').addEventListener('submit', async e=>{
    e.preventDefault();
    if(!state.bettingOpen){ syncBetEntryState(); toast('Betting is currently closed'); return; }
    if (betSubmissionPending) return;
    const bettor=$('#bettorName').value.trim(), pairId=$('#betPair').value, amount=Number($('#betAmount').value);
    if(!bettor||!pairId||!Number.isFinite(amount)||amount<=0)return;
    const newBet = {id:crypto.randomUUID(),bettor,pairId,amount,createdAt:new Date().toISOString()};
    betSubmissionPending = true;
    syncBetEntryState();
    state.bets.push(newBet); state.settledWinnerId=null; state.preSettlementBettingOpen=null; settlementPreview=null;
    try {
      await persist();
      $('#betAmount').value='';
      toast(`${currency(amount)} bet added`);
    } catch (error) {
      console.error('Unable to save bet:', error);
      state.bets = state.bets.filter(b => b.id !== newBet.id);
      toast('Bet could not be saved');
    } finally {
      betSubmissionPending = false;
      renderAll();
    }
  });
  $('#toggleBettingBtn').addEventListener('click',async()=>{
    const nextOpen = !state.bettingOpen;
    if (nextOpen && state.settledWinnerId) {
      await showNotice('Undo the final payout before reopening betting.', { title: 'Settlement is finalized' });
      return;
    }
    await setBettingOpen(nextOpen);
    toast(nextOpen?'Betting reopened':'Betting closed');
  });
  $('#settingsBtn').addEventListener('click',()=>{ $('#settingTournamentName').value=state.tournamentName; $('#settingFee').value=state.feePercent; $('#settingsModal').classList.remove('hidden'); });
  $('#closeSettingsBtn').addEventListener('click',()=>$('#settingsModal').classList.add('hidden'));
  $('#settingsModal').addEventListener('click',e=>{if(e.target.id==='settingsModal')$('#settingsModal').classList.add('hidden')});
  $('#settingsForm').addEventListener('submit',async e=>{e.preventDefault();state.tournamentName=$('#settingTournamentName').value.trim()||'Badminton Championship Pool';state.feePercent=Math.min(25,Math.max(0,Number($('#settingFee').value||0)));await persist();$('#settingsModal').classList.add('hidden');renderAll();toast('Pool settings saved');});
  $('#savePairsBtn').addEventListener('click',async()=>{if(!(await savePairEdits()))return;await persist();renderAll();toast('Pair changes saved');});
  $$('.add-pair-btn').forEach(button => button.addEventListener('click', async () => addPair(button.dataset.group)));
  $('#ledgerSearch').addEventListener('input',renderLedger);
  $('#clearBetsBtn').addEventListener('click',async()=>{if(!state.bets.length)return;if(!(await showConfirm('This will permanently remove every bet from this tournament.', { title: 'Clear all bets?', confirmText: 'Clear All Bets', danger: true })))return;state.bets=[];state.settledWinnerId=null;state.preSettlementBettingOpen=null;settlementPreview=null;await persist();renderAll();toast('All bets cleared');});
  $('#winnerSelect').addEventListener('change',renderSettlement);
  $('#settleBtn').addEventListener('click',async()=>{
    const id=$('#winnerSelect').value;
    if(!id){await showNotice('Select the winning pair first.', { title: 'Winning pair required' });return;}
    if(state.settledWinnerId){return;}
    if(!(await showConfirm(`Finalize settlement for ${pairName(getPair(id))}? Betting will be closed when the settlement is finalized.`, { title: 'Finalize settlement?', confirmText: 'Finalize' })))return;
    state.preSettlementBettingOpen=state.bettingOpen;
    state.settledWinnerId=id;
    state.bettingOpen=false;
    settlementPreview=calculateSettlement(id);
    await persist();
    renderAll();
    toast('Pool settlement finalized');
  });
  $('#undoSettlementBtn').addEventListener('click',async()=>{
    if(!state.settledWinnerId)return;
    const pair=getPair(state.settledWinnerId);
    const restoreOpen = typeof state.preSettlementBettingOpen === 'boolean' ? state.preSettlementBettingOpen : true;
    if(!(await showConfirm(`Undo the final payout for ${pair ? pairName(pair) : 'the selected winner'}? The bets will remain unchanged and the settlement will return to preview mode.`, { title: 'Undo final payout?', confirmText: 'Undo Final Payout' })))return;
    state.settledWinnerId=null;
    state.bettingOpen=restoreOpen;
    state.preSettlementBettingOpen=null;
    settlementPreview=null;
    await persist();
    renderAll();
    toast(restoreOpen ? 'Final payout undone • Betting reopened' : 'Final payout undone');
  });
  $('#exportSettlementBtn').addEventListener('click',async()=>{const csv=settlementCsv();if(!csv){await showNotice('Select a winning pair first.', { title: 'Winning pair required' });return;}const r=await window.poolAPI.exportSettlementCsv(csv);if(r.ok)toast('Settlement CSV exported');});
  $('#exportBtn').addEventListener('click',async()=>{const r=await window.poolAPI.exportState(state);if(r.ok)toast('Tournament exported');});
  $('#resetTournamentBtn').addEventListener('click',async()=>{if(!(await showConfirm('This will reset the entire tournament, including every bet, pair name, profile picture, and setting.', { title: 'Reset tournament?', confirmText: 'Reset Tournament', danger: true })))return;const zoomFactor=state.zoomFactor;state=makeDefaultState();state.zoomFactor=zoomFactor;settlementPreview=null;await persist();$('#settingsModal').classList.add('hidden');renderAll();toast('Tournament reset');});
}

async function init() {
  const saved = await window.poolAPI.loadState();
  if (saved && Array.isArray(saved.pairs) && Array.isArray(saved.bets)) {
    state = { ...makeDefaultState(), ...saved };
    state.pairs = saved.pairs.map(pair => {
      const { rank: _legacyRank, ...withoutRank } = pair;
      return {
        player1Photo: null,
        player2Photo: null,
        ...withoutRank,
        group: normalizeGroup(withoutRank.group)
      };
    });
    const validPairIds = new Set(state.pairs.map(p => p.id));
    state.bets = saved.bets.filter(b => validPairIds.has(b.pairId));
    if (state.settledWinnerId && !validPairIds.has(state.settledWinnerId)) {
      state.settledWinnerId = null;
      state.preSettlementBettingOpen = null;
    }
  }
  state.zoomFactor = clampZoom(state.zoomFactor);
  await window.poolAPI.setZoomFactor(state.zoomFactor);
  bindEvents();
  renderAll();
}
init();
