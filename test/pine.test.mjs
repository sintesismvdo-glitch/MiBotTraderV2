import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pine = readFileSync(new URL('../tradingview/MiBotTraderV2_1_BTC.pine', import.meta.url), 'utf8');

test('Pine mirror explicitly restricts symbol and chart timeframe', () => {
  assert.match(pine, /^\/\/@version=6/m);
  assert.match(pine, /syminfo\.ticker != "BTCUSDT\.P"/);
  assert.match(pine, /timeframe\.in_seconds\(timeframe\.period\) != 60/);
  assert.match(pine, /commission_value = 0\.05/);
  assert.match(pine, /margin_long = 10, margin_short = 10/);
});

test('all six higher-timeframe requests use offset state with lookahead protection', () => {
  const requests = [...pine.matchAll(/request\.security\([^\n]+/g)].map(x => x[0]);
  assert.equal(requests.length, 6);
  for (const request of requests) {
    assert.match(request, /f_closed_state\(\)/);
    assert.match(request, /lookahead = barmerge\.lookahead_on/);
  }
  assert.match(pine, /\[t\[1\], s\[1\], el\[1\], es\[1\], cl\[1\], cs\[1\]\]/);
  assert.match(pine, /m1S == h1T and m1S == m3T and m1S == m5T/);
});
