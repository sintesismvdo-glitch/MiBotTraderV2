import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext, Script } from 'node:vm';
import { runBacktest, validateBars } from '../lab/backtest.mjs';
import { atOrBefore, calculate, resample } from '../lab/signals.mjs';
import { adx, ema, squeeze, stochRsi } from '../lab/indicators.mjs';

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

test('laboratory indicators match the published browser formulas', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const start = html.indexOf('  function computeSMA(');
  const end = html.indexOf('  function evalSignalAt(', start);
  assert.ok(start > 0 && end > start);
  const old = runInNewContext(`${html.slice(start, end)}; ({computeEMA, computeADX, computeSqueeze, computeStochRSI})`);
  const close = Array.from({ length: 240 }, (_, i) => 100 + i * 0.04 + Math.sin(i / 4) * 2 + Math.cos(i / 11));
  const high = close.map((c, i) => c + 1 + i % 3 * 0.05);
  const low = close.map((c, i) => c - 1 - i % 4 * 0.03);
  const compare = (a, b) => {
    assert.equal(a.length, b.length);
    for (let i = 0; i < a.length; i++) {
      if (a[i] == null || b[i] == null) assert.equal(a[i], b[i], `index ${i}`);
      else assert.ok(Math.abs(a[i] - b[i]) < 1e-8, `index ${i}: ${a[i]} vs ${b[i]}`);
    }
  };
  compare(ema(close, 55), old.computeEMA(close, 55));
  const baselineAdx = old.computeADX(high, low, close, 14);
  const labAdx = adx(high, low, close, 14);
  compare(labAdx.adx, baselineAdx.adx);
  compare(labAdx.plusDI, baselineAdx.plusDI);
  compare(labAdx.minusDI, baselineAdx.minusDI);
  compare(squeeze(high, low, close), old.computeSqueeze(high, low, close, 20, 2, 20, 1.5).val);
  const oldStoch = old.computeStochRSI(close, 14, 14, 3, 3);
  const newStoch = stochRsi(close, 14, 14, 3, 3);
  compare(newStoch.k, oldStoch.k);
  compare(newStoch.d, oldStoch.d);
});

test('browser scripts remain syntactically valid', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 2);
  for (const [i, match] of scripts.entries()) new Script(match[1], { filename: `inline-${i}.js` });
});

