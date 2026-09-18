import { calculate, DEFAULT_PARAMS, diagnose, evaluate, INTERVAL_MS, PRIORITY, resample } from './signals.mjs';

export const DEFAULT_EXECUTION = Object.freeze({
  initialBalance: 100000, margin: 100, leverage: 10,
  feeRate: 0.0005, slippageRate: 0.0002,
  stopMarginPct: -20, takeMarginPct: 25, breakevenMarginPct: 10,
});

export function validateBars(bars) {
  if (!Array.isArray(bars) || !bars.length) throw new Error('Se necesitan velas históricas.');
  let previous = -Infinity;
  for (const bar of bars) {
    if (![bar.openTime, bar.closeTime, bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite)) throw new Error('Vela incompleta o no numérica.');
    if (bar.openTime <= previous || bar.closeTime - bar.openTime !== 60000 || bar.open <= 0 || bar.low <= 0 || bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close)) throw new Error('Velas no ordenadas o precios OHLC inválidos.');
    if (previous !== -Infinity && bar.openTime - previous !== 60000) throw new Error('Hay huecos en las velas de 1 minuto.');
    previous = bar.openTime;
  }
}

function fill(price, dir, side, slip) {
  const buy = (dir === 'LONG' && side === 'entry') || (dir === 'SHORT' && side === 'exit');
  return price * (buy ? 1 + slip : 1 - slip);
}

function exitPosition(pos, rawPrice, time, reason, cash, cfg) {
  const price = fill(rawPrice, pos.dir, 'exit', cfg.slippageRate);
  const gross = pos.quantity * (pos.dir === 'LONG' ? price - pos.entryPrice : pos.entryPrice - price);
  const fee = pos.quantity * price * cfg.feeRate;
  const net = gross - pos.entryFee - fee + pos.fundingPnl;
  return { cash: cash + pos.margin + gross - fee, trade: {
    slot: pos.slot, dir: pos.dir, signalTime: pos.signalTime, diagnostics: pos.diagnostics,
    entryTime: pos.entryTime, exitTime: time,
    entryPrice: pos.entryPrice, exitPrice: price, margin: pos.margin,
    grossPnl: gross, fees: pos.entryFee + fee, fundingPnl: pos.fundingPnl,
    netPnl: net, reason,
  } };
}

export function runBacktest(bars, funding = [], params = DEFAULT_PARAMS, options = {}) {
  validateBars(bars);
  const cfg = { ...DEFAULT_EXECUTION, ...options };
  const signalProvider = options.signalProvider;
  const tfs = Object.fromEntries(Object.entries(INTERVAL_MS).map(([tf, ms]) => [tf, calculate(resample(bars, ms), params)]));
  const warmupIndex = tfs['1d'].slow.findIndex(x => x != null);
  const warmupEnd = warmupIndex < 0 ? Infinity : tfs['1d'].bars[warmupIndex].closeTime;
  const fundingByTime = new Map(funding.map(x => [x.fundingTime, x.fundingRate]));
  let cash = cfg.initialBalance, pos = null, pending = null, lastExitTime = -Infinity;
  const seenSignals = new Set();
  const trades = [], equity = [], counts = Object.fromEntries(PRIORITY.map(x => [x, 0]));
  for (const bar of bars) {
    // Signals from a closed candle may fill only at the next minute open.
    if (pending && !pos) {
      const entryPrice = fill(bar.open, pending.dir, 'entry', cfg.slippageRate);
      const quantity = cfg.margin * cfg.leverage / entryPrice;
      const entryFee = quantity * entryPrice * cfg.feeRate;
      if (cash >= cfg.margin + entryFee) {
        cash -= cfg.margin + entryFee;
        pos = { ...pending, entryTime: bar.openTime, entryPrice, quantity, margin: cfg.margin,
          entryFee, fundingPnl: 0, breakevenActive: false };
        counts[pending.slot]++;
      }
    }
    pending = null;

    if (pos) {
      const rate = fundingByTime.get(bar.openTime);
      if (rate != null) {
        const fundingPnl = -pos.quantity * bar.open * rate * (pos.dir === 'LONG' ? 1 : -1);
        pos.fundingPnl += fundingPnl;
        cash += fundingPnl;
      }
      const priceMove = pct => pct / (100 * cfg.leverage);
      const stop = pos.dir === 'LONG' ? pos.entryPrice * (1 + priceMove(pos.breakevenActive ? 0 : cfg.stopMarginPct))
        : pos.entryPrice * (1 - priceMove(pos.breakevenActive ? 0 : cfg.stopMarginPct));
      const take = pos.dir === 'LONG' ? pos.entryPrice * (1 + priceMove(cfg.takeMarginPct))
        : pos.entryPrice * (1 - priceMove(cfg.takeMarginPct));
      const trigger = pos.dir === 'LONG' ? pos.entryPrice * (1 + priceMove(cfg.breakevenMarginPct))
        : pos.entryPrice * (1 - priceMove(cfg.breakevenMarginPct));
      const stopHit = pos.dir === 'LONG' ? bar.low <= stop : bar.high >= stop;
      const takeHit = pos.dir === 'LONG' ? bar.high >= take : bar.low <= take;
      if (stopHit || takeHit) {
        // If both levels occur in the same minute, take the adverse outcome.
        // A gap through stop fills at the open; otherwise at the stop level.
        const gap = pos.dir === 'LONG' ? bar.open < stop : bar.open > stop;
        const raw = stopHit ? (gap ? bar.open : stop) : take;
        const result = exitPosition(pos, raw, bar.closeTime, stopHit ? (pos.breakevenActive ? 'Breakeven' : 'Stop Loss') : 'Take Profit', cash, cfg);
        cash = result.cash; trades.push(result.trade); pos = null; lastExitTime = bar.closeTime;
      } else if (!pos.breakevenActive && (pos.dir === 'LONG' ? bar.high >= trigger : bar.low <= trigger)) {
        // Breakeven becomes active on the next minute, avoiding unknown intrabar order.
        pos.breakevenActive = true;
      }
    }
    const unrealized = pos ? pos.quantity * (pos.dir === 'LONG' ? bar.close - pos.entryPrice : pos.entryPrice - bar.close) : 0;
    equity.push({ time: bar.closeTime, equity: cash + (pos ? pos.margin + unrealized : 0) });

    if (!pos && (options.warmup === false || bar.closeTime >= warmupEnd)) {
      const { slots, index } = signalProvider ? signalProvider(bar.closeTime, tfs) : evaluate(tfs, bar.closeTime, params);
      for (const key of PRIORITY) {
        if (!slots[key] || slots[key] === 'NONE') continue;
        const tf = key === 'principal' ? params.signalInterval : key.startsWith('multi:') ? key.slice(6) : '5m';
        const signalTime = signalProvider ? bar.closeTime : tfs[tf].bars[index[tf]]?.closeTime;
        if (signalTime == null || signalTime <= lastExitTime) continue;
        const identity = `${key}:${slots[key]}:${signalTime}`;
        if (seenSignals.has(identity)) continue;
        seenSignals.add(identity);
        pending = { slot: key, dir: slots[key], signalTime,
          diagnostics: signalProvider ? null : diagnose(tfs[tf], index[tf], params) };
        break;
      }
    }
  }
  return { config: { params, execution: { ...cfg, signalProvider: undefined } }, warmupEnd: Number.isFinite(warmupEnd) ? warmupEnd : null, trades, equity, counts,
    finalEquity: equity.at(-1).equity, openPosition: pos ? { slot: pos.slot, dir: pos.dir, entryTime: pos.entryTime } : null };
}

export function summarize(result) {
  const closed = result.trades, wins = closed.filter(t => t.netPnl > 0), losses = closed.filter(t => t.netPnl < 0);
  const grossWin = wins.reduce((s, t) => s + t.netPnl, 0), grossLoss = -losses.reduce((s, t) => s + t.netPnl, 0);
  const group = selected => {
    const positive = selected.filter(t => t.netPnl > 0);
    const gain = positive.reduce((s, t) => s + t.netPnl, 0);
    const loss = -selected.filter(t => t.netPnl < 0).reduce((s, t) => s + t.netPnl, 0);
    const netPnl = selected.reduce((s, t) => s + t.netPnl, 0);
    return { trades: selected.length, wins: positive.length, losses: selected.filter(t => t.netPnl < 0).length,
      winRatePct: selected.length ? 100 * positive.length / selected.length : null,
      profitFactor: loss ? gain / loss : null, expectancyUsdt: selected.length ? netPnl / selected.length : null,
      netPnl, totalFees: selected.reduce((s, t) => s + t.fees, 0),
      totalFundingPnl: selected.reduce((s, t) => s + t.fundingPnl, 0) };
  };
  let peak = -Infinity, maxDrawdownPct = 0;
  for (const point of result.equity) {
    peak = Math.max(peak, point.equity);
    maxDrawdownPct = Math.max(maxDrawdownPct, peak > 0 ? (peak - point.equity) / peak * 100 : 0);
  }
  const bySide = Object.fromEntries(['LONG', 'SHORT'].map(dir => [dir, group(closed.filter(t => t.dir === dir))]));
  const bySlot = Object.fromEntries(PRIORITY.map(slot => [slot, group(closed.filter(t => t.slot === slot))]));
  return { trades: closed.length, wins: wins.length, losses: losses.length,
    winRatePct: closed.length ? 100 * wins.length / closed.length : null,
    profitFactor: grossLoss ? grossWin / grossLoss : null,
    expectancyUsdt: closed.length ? closed.reduce((s, t) => s + t.netPnl, 0) / closed.length : null,
    maxDrawdownPct, finalEquity: result.finalEquity,
    totalFees: closed.reduce((s, t) => s + t.fees, 0),
    totalFundingPnl: closed.reduce((s, t) => s + t.fundingPnl, 0), bySide, bySlot };
}
