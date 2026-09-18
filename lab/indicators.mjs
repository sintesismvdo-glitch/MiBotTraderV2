export function sma(values, len) {
  const out = Array(values.length).fill(null);
  for (let i = len - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - len + 1; j <= i; j++) sum += values[j];
    out[i] = sum / len;
  }
  return out;
}

export function ema(values, len) {
  const out = Array(values.length).fill(null);
  if (values.length < len) return out;
  const k = 2 / (len + 1);
  out[len - 1] = values.slice(0, len).reduce((a, b) => a + b, 0) / len;
  for (let i = len; i < values.length; i++) out[i] = values[i] * k + out[i - 1] * (1 - k);
  return out;
}

export function rma(values, len) {
  const out = Array(values.length).fill(null);
  if (values.length < len) return out;
  out[len - 1] = values.slice(0, len).reduce((a, b) => a + b, 0) / len;
  for (let i = len; i < values.length; i++) out[i] = (out[i - 1] * (len - 1) + values[i]) / len;
  return out;
}

export function adx(high, low, close, len = 14) {
  const n = close.length;
  const tr = Array(n).fill(0), plus = Array(n).fill(0), minus = Array(n).fill(0);
  tr[0] = high[0] - low[0];
  for (let i = 1; i < n; i++) {
    const up = high[i] - high[i - 1], down = low[i - 1] - low[i];
    tr[i] = Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]));
    plus[i] = up > down && up > 0 ? up : 0;
    minus[i] = down > up && down > 0 ? down : 0;
  }
  const atr = rma(tr, len), p = rma(plus, len), m = rma(minus, len);
  const plusDI = Array(n).fill(null), minusDI = Array(n).fill(null), dx = Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (atr[i] == null || atr[i] === 0) continue;
    plusDI[i] = 100 * p[i] / atr[i];
    minusDI[i] = 100 * m[i] / atr[i];
    const sum = plusDI[i] + minusDI[i];
    dx[i] = sum === 0 ? 0 : 100 * Math.abs(plusDI[i] - minusDI[i]) / sum;
  }
  const start = dx.findIndex(x => x != null), result = Array(n).fill(null);
  if (start >= 0) {
    const smoothed = rma(dx.slice(start), len);
    for (let i = 0; i < smoothed.length; i++) result[start + i] = smoothed[i];
  }
  return { adx: result, plusDI, minusDI };
}

export function squeeze(high, low, close, len = 20) {
  // Mirrors the v3.4.1 momentum calculation; channel state is not used by its signal.
  const source = Array(close.length).fill(null), value = Array(close.length).fill(null);
  const mean = sma(close, len);
  for (let i = len - 1; i < close.length; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - len + 1; j <= i; j++) { hi = Math.max(hi, high[j]); lo = Math.min(lo, low[j]); }
    source[i] = close[i] - ((hi + lo) / 2 + mean[i]) / 2;
  }
  for (let i = 2 * len - 2; i < close.length; i++) {
    const ys = source.slice(i - len + 1, i + 1);
    const sumY = ys.reduce((a, b) => a + b, 0);
    const sumXY = ys.reduce((a, b, x) => a + x * b, 0);
    const sumX = len * (len - 1) / 2;
    const sumX2 = len * (len - 1) * (2 * len - 1) / 6;
    const slope = (len * sumXY - sumX * sumY) / (len * sumX2 - sumX * sumX);
    value[i] = (sumY - slope * sumX) / len + slope * (len - 1);
  }
  return value;
}

export function stochRsi(close, rsiLen = 14, stochLen = 14, kLen = 3, dLen = 3) {
  const gains = Array(close.length).fill(0), losses = Array(close.length).fill(0);
  for (let i = 1; i < close.length; i++) {
    const change = close[i] - close[i - 1];
    gains[i] = Math.max(0, change); losses[i] = Math.max(0, -change);
  }
  const avgGain = rma(gains, rsiLen), avgLoss = rma(losses, rsiLen);
  const rsi = close.map((_, i) => avgGain[i] == null ? null : avgLoss[i] === 0 ? 100 : 100 - 100 / (1 + avgGain[i] / avgLoss[i]));
  const raw = Array(close.length).fill(null);
  for (let i = rsiLen + stochLen - 2; i < close.length; i++) {
    const window = rsi.slice(i - stochLen + 1, i + 1);
    const hi = Math.max(...window), lo = Math.min(...window);
    raw[i] = hi === lo ? 50 : 100 * (rsi[i] - lo) / (hi - lo);
  }
  const smooth = (values, length) => values.map((_, i) => {
    if (i < length - 1) return null;
    const window = values.slice(i - length + 1, i + 1);
    return window.some(v => v == null) ? null : window.reduce((a, b) => a + b, 0) / length;
  });
  const k = smooth(raw, kLen);
  return { k, d: smooth(k, dLen) };
}

