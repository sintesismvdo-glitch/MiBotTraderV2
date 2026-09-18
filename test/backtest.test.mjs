import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { spawnSync } from 'node:child_process';
import { runBacktest, summarize, validateBars } from '../lab/backtest.mjs';
import { V21_PARAMS, atOrBefore, calculate, diagnose, evaluate, resample } from '../lab/signals.mjs';

const minute = 60000;
function bars(prices) {
  return prices.map((price, i) => ({ openTime: i * minute, closeTime: (i + 1) * minute,
    open: price, high: price, low: price, close: price, volume: 1 }));
}

test('rejects missing minutes instead of silently backtesting through gaps', () => {
  const input = bars([100, 101, 102]);
  input[2].openTime += minute;
  input[2].closeTime += minute;
  assert.throws(() => validateBars(input), /huecos/);
});

test('higher timeframe is unavailable until its candle closes', () => {
  const input = bars([100, 101, 102, 103]);
  const bundle = calculate(resample(input, 3 * minute));
  assert.equal(bundle.bars.length, 1);
  assert.equal(atOrBefore(bundle, 2 * minute), -1);
  assert.equal(atOrBefore(bundle, 3 * minute), 0);
});

test('signal at candle close fills at next open and applies both fees', () => {
  const input = bars([100, 100, 102, 102]);
  const result = runBacktest(input, [], undefined, {
    feeRate: 0.001, slippageRate: 0, takeMarginPct: 10, stopMarginPct: -20,
    breakevenMarginPct: 50, warmup: false,
    signalProvider: time => ({ slots: { principal: time === minute ? 'LONG' : 'NONE' }, index: {} }),
  });
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].entryTime, minute);
  assert.equal(result.trades[0].reason, 'Take Profit');
  assert.ok(result.trades[0].fees > 0);
});

test('same minute stop and target selects stop', () => {
  const input = bars([100, 100, 100, 100]);
  input[2].high = 103; input[2].low = 97;
  const result = runBacktest(input, [], undefined, {
    feeRate: 0, slippageRate: 0, takeMarginPct: 25, stopMarginPct: -20,
    breakevenMarginPct: 50, warmup: false,
    signalProvider: time => ({ slots: { principal: time === minute ? 'LONG' : 'NONE' }, index: {} }),
  });
  assert.equal(result.trades[0].reason, 'Stop Loss');
  assert.equal(result.trades[0].grossPnl, -20);
});

test('funding is charged to a long held at funding time', () => {
  const input = bars([100, 100, 100]);
  const result = runBacktest(input, [{ fundingTime: minute, fundingRate: 0.001 }], undefined, {
    feeRate: 0, slippageRate: 0, warmup: false,
    signalProvider: time => ({ slots: { principal: time === minute ? 'LONG' : 'NONE' }, index: {} }),
  });
  assert.equal(result.finalEquity, 99999);
});

test('browser imports the same signal engine and contains no second indicator implementation', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<script type="module">\s*import \{[^}]*calculate, evaluate \} from '\.\/lab\/signals\.mjs'/);
  assert.doesNotMatch(html, /function compute(?:EMA|ADX|Squeeze|StochRSI)/);
  const scripts = [...html.matchAll(/<script(?: type="module")?>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 2);
  new Script(scripts[0][1], { filename: 'ui.js' });
  const check = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: scripts[1][1], encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
});

test('1m V2.1 signal needs aligned 3m and 5m trends', () => {
  const make = (fast, slow) => ({
    bars: [{ closeTime: minute, close: 100 }, { closeTime: 2 * minute, close: 101 }],
    fast: [fast, fast], slow: [slow, slow], sqz: [1, 1],
    adx: [30, 30], plusDI: [25, 25], minusDI: [10, 10],
    k: [5, 15], d: [10, 10],
  });
  const tf = Object.fromEntries(['1m', '3m', '5m', '15m', '1h', '4h', '1d'].map(x => [x, make(2, 1)]));
  tf['5m'] = make(1, 2);
  assert.equal(evaluate(tf, 2 * minute, V21_PARAMS).slots['multi:1m'], 'NONE');
  tf['5m'] = make(2, 1);
  assert.equal(evaluate(tf, 2 * minute, V21_PARAMS).slots['multi:1m'], 'LONG');
  assert.equal(evaluate(tf, 2 * minute, { ...V21_PARAMS, oneMinuteAlignment: false }).slots['multi:1m'], 'LONG');
});

test('V4 measurements expose slopes, extension and exhaustion without hidden thresholds', () => {
  const bundle = { bars: [{ close: 100 }, { close: 105 }, { close: 110 }],
    fast: [100, 102, 105], slow: [99, 100, 101],
    adx: [30, 29, 28], sqz: [8, 6, 4], k: [10, 12, 14] };
  const d = diagnose(bundle, 2);
  assert.equal(d.adxSlope, -1);
  assert.equal(d.sqzSlope, -2);
  assert.ok(d.ema10DistancePct > 0);
  assert.ok(d.ema55DistancePct > d.ema10DistancePct);
  assert.equal(d.exhaustionLong, true);
});

test('summary separates LONG/SHORT and each executed slot', () => {
  const trades = [
    { dir: 'LONG', slot: 'principal', netPnl: 20, fees: 1, fundingPnl: 0 },
    { dir: 'LONG', slot: 'principal', netPnl: -10, fees: 1, fundingPnl: 0 },
    { dir: 'SHORT', slot: 'multi:1m', netPnl: -5, fees: 1, fundingPnl: 0 },
  ];
  const s = summarize({ trades, equity: [{ equity: 100000 }, { equity: 100005 }], finalEquity: 100005 });
  assert.equal(s.bySide.LONG.trades, 2);
  assert.equal(s.bySide.LONG.profitFactor, 2);
  assert.equal(s.bySide.SHORT.expectancyUsdt, -5);
  assert.equal(s.bySlot.principal.trades, 2);
  assert.equal(s.bySlot['multi:1m'].netPnl, -5);
});
