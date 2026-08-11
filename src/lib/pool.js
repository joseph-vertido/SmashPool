export const GROUPS = ['Advantage', 'Challenge'];

export const defaultPairs = [
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

export const makeDefaultState = () => ({
  tournamentName: 'Badminton Championship Pool',
  feePercent: 0,
  bettingOpen: true,
  settledWinnerId: null,
  preSettlementBettingOpen: null,
  zoomFactor: 1,
  pairs: structuredClone(defaultPairs),
  bets: []
});

export function normalizeGroup(group) {
  return group === 'Challenge' || group === 'B' ? 'Challenge' : 'Advantage';
}

export function migrateState(saved) {
  const base = makeDefaultState();
  if (!saved || !Array.isArray(saved.pairs) || !Array.isArray(saved.bets)) return base;
  const next = { ...base, ...saved };
  next.pairs = saved.pairs.map(pair => {
    const { rank: _legacyRank, ...withoutRank } = pair || {};
    return {
      id: withoutRank.id || crypto.randomUUID(),
      player1: withoutRank.player1 || 'Player 1',
      player2: withoutRank.player2 || 'Player 2',
      player1Photo: withoutRank.player1Photo || null,
      player2Photo: withoutRank.player2Photo || null,
      ...withoutRank,
      group: normalizeGroup(withoutRank.group)
    };
  });
  const validIds = new Set(next.pairs.map(pair => pair.id));
  next.bets = saved.bets.filter(bet => validIds.has(bet.pairId));
  if (next.settledWinnerId && !validIds.has(next.settledWinnerId)) {
    next.settledWinnerId = null;
    next.preSettlementBettingOpen = null;
  }
  next.zoomFactor = clampZoom(next.zoomFactor);
  next.feePercent = Math.min(25, Math.max(0, Number(next.feePercent || 0)));
  return next;
}

export function pairName(pair) {
  return pair ? `${pair.player1} / ${pair.player2}` : 'Unknown Pair';
}

export function currency(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
}

export function pct(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

export function totalPool(state) {
  return state.bets.reduce((sum, bet) => sum + Number(bet.amount || 0), 0);
}

export function prizePool(state) {
  return totalPool(state) * (1 - Number(state.feePercent || 0) / 100);
}

export function totalOnPair(state, pairId) {
  return state.bets.filter(bet => bet.pairId === pairId).reduce((sum, bet) => sum + Number(bet.amount || 0), 0);
}

export function bettorsOnPair(state, pairId) {
  return new Set(
    state.bets
      .filter(bet => bet.pairId === pairId)
      .map(bet => String(bet.bettor || '').trim().toLowerCase())
      .filter(Boolean)
  ).size;
}

export function pairMultiplier(state, pairId, prospectiveAmount = 0) {
  const nextPool = totalPool(state) + Number(prospectiveAmount || 0);
  const nextPair = totalOnPair(state, pairId) + Number(prospectiveAmount || 0);
  if (nextPair <= 0 || nextPool <= 0) return null;
  return (nextPool * (1 - Number(state.feePercent || 0) / 100)) / nextPair;
}

export function calculateSettlement(state, pairId) {
  const winnerBets = state.bets.filter(bet => bet.pairId === pairId);
  const winnerTotal = winnerBets.reduce((sum, bet) => sum + Number(bet.amount || 0), 0);
  const prize = prizePool(state);
  const payouts = winnerBets.map(bet => {
    const share = winnerTotal ? Number(bet.amount) / winnerTotal : 0;
    const payout = prize * share;
    return { ...bet, share, payout, profit: payout - Number(bet.amount) };
  });
  return { pairId, winnerTotal, prize, payouts };
}

export const MIN_ZOOM = 0.7;
export const MAX_ZOOM = 1.5;
export const ZOOM_STEP = 0.1;
export function clampZoom(value) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((Number(value) || 1) * 10) / 10));
}

export function playerInitials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return parts.slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

export function safePhotoSrc(value) {
  const src = typeof value === 'string' ? value.trim() : '';
  if (/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(src)) return src;
  if (/^https:\/\//i.test(src)) return src;
  return '';
}

export async function resizeProfilePhoto(file) {
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

export function nextPairNumber(pairs) {
  const used = pairs.map(pair => {
    const matches = `${pair.player1} ${pair.player2}`.match(/Pair\s+(\d+)/i);
    return matches ? Number(matches[1]) : 0;
  });
  return Math.max(pairs.length, ...used, 0) + 1;
}

export function settlementCsv(state, pairId) {
  if (!pairId) return null;
  const pair = state.pairs.find(item => item.id === pairId);
  if (!pair) return null;
  const calc = calculateSettlement(state, pairId);
  const esc = value => `"${String(value).replaceAll('"', '""')}"`;
  const header = ['Tournament','Winning Pair','Group','Bettor','Winning Bet','Share','Total Return','Profit'];
  const lines = calc.payouts.map(item => [
    state.tournamentName,
    pairName(pair),
    pair.group,
    item.bettor,
    item.amount,
    `${(item.share * 100).toFixed(2)}%`,
    item.payout.toFixed(2),
    item.profit.toFixed(2)
  ]);
  return [header, ...lines].map(row => row.map(esc).join(',')).join('\n');
}

export function downloadText(filename, text, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function buildPublicDashboard(state) {
  const total = totalPool(state);
  const prize = prizePool(state);
  const originalOrder = new Map(state.pairs.map((pair, index) => [pair.id, index]));
  const pairs = state.pairs.map(pair => {
    const pairBets = state.bets.filter(bet => bet.pairId === pair.id);
    const betTotal = pairBets.reduce((sum, bet) => sum + Number(bet.amount || 0), 0);
    const multiplier = pairMultiplier(state, pair.id);
    const bettorMap = new Map();
    pairBets.forEach(bet => {
      const displayName = String(bet.bettor || '').trim() || 'Anonymous';
      const key = displayName.toLowerCase();
      const existing = bettorMap.get(key) || { bettor: displayName, amount: 0, betCount: 0 };
      existing.amount += Number(bet.amount || 0);
      existing.betCount += 1;
      bettorMap.set(key, existing);
    });
    const bettors = Array.from(bettorMap.values())
      .sort((a, b) => (b.amount - a.amount) || a.bettor.localeCompare(b.bettor))
      // Public dashboard intentionally omits bettor names. The name is used
      // only above to aggregate multiple wagers by the same person.
      .map(({ amount, betCount }) => ({ amount, betCount }));

    return {
      id: pair.id,
      group: pair.group,
      player1: pair.player1,
      player2: pair.player2,
      player1Photo: pair.player1Photo || null,
      player2Photo: pair.player2Photo || null,
      betTotal,
      bettorCount: bettors.length,
      bettors,
      poolShare: total ? betTotal / total * 100 : 0,
      multiplier: multiplier || null,
      twentyPays: multiplier ? 20 * multiplier : null
    };
  }).sort((a, b) => (b.betTotal - a.betTotal) || (originalOrder.get(a.id) - originalOrder.get(b.id)));

  const uniqueBettors = new Set(
    state.bets.map(bet => String(bet.bettor || '').trim().toLowerCase()).filter(Boolean)
  ).size;
  const leader = pairs.find(pair => pair.betTotal > 0) || null;
  const recentBets = state.bets.slice().reverse().slice(0, 10).map(bet => {
    const pair = state.pairs.find(item => item.id === bet.pairId);
    return {
      id: bet.id,
      pairId: bet.pairId,
      amount: Number(bet.amount || 0),
      createdAt: bet.createdAt || null,
      pairName: pairName(pair),
      group: pair?.group || ''
    };
  });

  return {
    tournamentName: state.tournamentName,
    feePercent: Number(state.feePercent || 0),
    bettingOpen: Boolean(state.bettingOpen),
    totalPool: total,
    prizePool: prize,
    uniqueBettors,
    totalBets: state.bets.length,
    mostBetOnPairId: leader?.id || null,
    pairs,
    recentBets
  };
}
