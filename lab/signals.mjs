import { ema, adx, squeeze, stochRsi } from './indicators.mjs';

export const INTERVAL_MS = { '1m': 60000, '3m': 180000, '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000 };
export const PRIORITY = ['cascadeFull', 'cascadePartial', 'principal', 'multi:4h', 'multi:1h', 'multi:15m', 'multi:5m', 'multi:3m', 'multi:1m'];
export const MULTI = [
  { entry: '4h', trend: '1d' }, { entry: '1h', trend: '1d' },
  { entry: '15m', trend: '4h' }, { entry: '5m', trend: '4h' },
  { entry: '3m', trend: '1h' }, { entry: '1m', trend: '1h' },
];
export const DEFAULT_PARAMS = Object.freeze({
  emaFast: 10, emaSlow: 55, adxThreshold: 23, stochRsiLen: 14,
  stochLen: 14, stochK: 3, stochD: 3, stochOS: 20, stochOB: 80,
  requireCross: true, trendInterval: '1d', signalInterval: '4h', dmiFilter: false,
  oneMinuteAlignment: false,
});
// V2.1 activates only the V4 conditions whose meaning is already explicit.
// Slopes and EMA extension are measured below, but have no invented thresholds.
export const V21_PARAMS = Object.freeze({ ...DEFAULT_PARAMS, dmiFilter: true, oneMinuteAlignment: true });

export function resample(bars, intervalMs) {
  const result = [];
  let group = null;
  for (const bar of bars) {
    const bucket = Math.floor(bar.openTime / intervalMs) * intervalMs;
    if (group?.openTime !== bucket) {
      group = { openTime: bucket, closeTime: bucket + intervalMs, open: bar.open,
        high: bar.high, low: bar.low, close: bar.close, volume: bar.volume };
      result.push(group);
    } else {
      group.high = Math.max(group.high, bar.high);
      group.low = Math.min(group.low, bar.low);
      group.close = bar.close;
      group.volume += bar.volume;
    }
  }
  // The final bucket may be incomplete. Never expose it to the signal engine.
  return result.filter(b => b.closeTime <= bars.at(-1).closeTime);
}

export function calculate(bars, params = DEFAULT_PARAMS) {
  const high = bars.map(x => x.high), low = bars.map(x => x.low), close = bars.map(x => x.close);
  const stoch = stochRsi(close, params.stochRsiLen, params.stochLen, params.stochK, params.stochD);
  return { bars, fast: ema(close, params.emaFast), slow: ema(close, params.emaSlow),
    sqz: squeeze(high, low, close), ...adx(high, low, close), k: stoch.k, d: stoch.d };
}

export function atOrBefore(bundle, time) {
  let lo = 0, hi = bundle.bars.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bundle.bars[mid].closeTime <= time) { found = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return found;
}

function trend(bundle, i) {
  if (i < 0 || bundle.fast[i] == null || bundle.slow[i] == null) return 'NONE';
  return bundle.fast[i] > bundle.slow[i] ? 'LONG' : bundle.fast[i] < bundle.slow[i] ? 'SHORT' : 'NONE';
}

function signal(bundle, i, params) {
  if (i < 1 || [bundle.sqz[i], bundle.adx[i], bundle.k[i], bundle.d[i], bundle.k[i-1], bundle.d[i-1]].some(x => x == null)) return 'NONE';
  if (bundle.adx[i] < params.adxThreshold) return 'NONE';
  const long = bundle.sqz[i] > 0 && (!params.dmiFilter || bundle.plusDI[i] > bundle.minusDI[i]) && bundle.k[i] <= params.stochOS &&
    (!params.requireCross || (bundle.k[i] > bundle.d[i] && bundle.k[i-1] <= bundle.d[i-1]));
  const short = bundle.sqz[i] < 0 && (!params.dmiFilter || bundle.minusDI[i] > bundle.plusDI[i]) && bundle.k[i] >= params.stochOB &&
    (!params.requireCross || (bundle.k[i] < bundle.d[i] && bundle.k[i-1] >= bundle.d[i-1]));
  return long ? 'LONG' : short ? 'SHORT' : 'NONE';
}

function exhaustion(bundle, i, dir, params) {
  if (i < 2 || [bundle.sqz[i], bundle.sqz[i-1], bundle.sqz[i-2], bundle.adx[i], bundle.adx[i-1], bundle.k[i], bundle.k[i-1]].some(x => x == null)) return false;
  const fade = Math.abs(bundle.sqz[i]) < Math.abs(bundle.sqz[i-1]) && Math.abs(bundle.sqz[i-1]) < Math.abs(bundle.sqz[i-2]) && bundle.adx[i] < bundle.adx[i-1];
  return dir === 'LONG' ? fade && (bundle.k[i-1] <= params.stochOS || bundle.k[i] <= params.stochOS) && bundle.k[i] > bundle.k[i-1]
    : fade && (bundle.k[i-1] >= params.stochOB || bundle.k[i] >= params.stochOB) && bundle.k[i] < bundle.k[i-1];
}

function confirmed(bundle, i, dir, params) {
  if (i < 2 || [bundle.k[i], bundle.k[i-1], bundle.k[i-2], bundle.d[i], bundle.d[i-1]].some(x => x == null)) return false;
  return dir === 'LONG' ? (bundle.k[i-1] <= params.stochOS || bundle.k[i-2] <= params.stochOS) && bundle.k[i-1] <= bundle.d[i-1] && bundle.k[i] > bundle.d[i]
    : (bundle.k[i-1] >= params.stochOB || bundle.k[i-2] >= params.stochOB) && bundle.k[i-1] >= bundle.d[i-1] && bundle.k[i] < bundle.d[i];
}

export function diagnose(bundle, i, params = DEFAULT_PARAMS) {
  if (i < 0) return null;
  const delta = key => i > 0 && bundle[key][i] != null && bundle[key][i - 1] != null
    ? bundle[key][i] - bundle[key][i - 1] : null;
  const close = bundle.bars[i]?.close;
  const distance = key => close > 0 && bundle[key][i] != null
    ? 100 * (close / bundle[key][i] - 1) : null;
  return {
    adxSlope: delta('adx'), sqzSlope: delta('sqz'),
    ema10DistancePct: distance('fast'), ema55DistancePct: distance('slow'),
    exhaustionLong: exhaustion(bundle, i, 'LONG', params),
    exhaustionShort: exhaustion(bundle, i, 'SHORT', params),
  };
}

export function evaluate(bundles, time, params = DEFAULT_PARAMS) {
  const index = Object.fromEntries(Object.entries(bundles).map(([tf, b]) => [tf, atOrBefore(b, time)]));
  const slots = {};
  const mainTrend = trend(bundles[params.trendInterval], index[params.trendInterval]);
  const mainSig = signal(bundles[params.signalInterval], index[params.signalInterval], params);
  slots.principal = mainSig === mainTrend ? mainSig : 'NONE';
  for (const { entry, trend: trendTf } of MULTI) {
    const s = signal(bundles[entry], index[entry], params);
    const aligned = entry !== '1m' || !params.oneMinuteAlignment ||
      (s === trend(bundles['3m'], index['3m']) && s === trend(bundles['5m'], index['5m']));
    slots[`multi:${entry}`] = aligned && s === trend(bundles[trendTf], index[trendTf]) ? s : 'NONE';
  }
  const chain = ['1d', '4h', '1h', '15m', '5m'];
  const dir = trend(bundles['1d'], index['1d']);
  const aligned = Object.fromEntries(chain.map(tf => [tf, dir !== 'NONE' && trend(bundles[tf], index[tf]) === dir]));
  const full = dir !== 'NONE' && chain.every(tf => aligned[tf]) &&
    chain.slice(0, -1).every(tf => exhaustion(bundles[tf], index[tf], dir, params)) &&
    confirmed(bundles['5m'], index['5m'], dir, params);
  const partial = dir !== 'NONE' && !aligned['4h'] && ['1d','1h','15m','5m'].every(tf => aligned[tf]) &&
    confirmed(bundles['5m'], index['5m'], dir, params);
  slots.cascadeFull = full ? dir : 'NONE';
  slots.cascadePartial = partial ? dir : 'NONE';
  return { slots, index };
}
