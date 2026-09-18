import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

const [from, to, output = 'data/btcusdt-perp.json'] = process.argv.slice(2);
if (!from || !to) {
  console.error('Uso: npm run download -- 2026-01-01 2026-04-01 data/btcusdt-perp.json');
  process.exit(2);
}
const start = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`);
if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || start % 60000 || end % 60000) throw new Error('Fechas UTC inválidas.');

async function request(path, query) {
  const url = new URL(`https://fapi.binance.com${path}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(url);
    if (response.ok) return response.json();
    if (![429, 418, 500, 502, 503].includes(response.status) || attempt === 3) throw new Error(`${path}: HTTP ${response.status}`);
    await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
  }
}

const bars = [];
for (let cursor = start; cursor < end;) {
  const raw = await request('/fapi/v1/klines', { symbol: 'BTCUSDT', interval: '1m', startTime: cursor, endTime: end - 1, limit: 1500 });
  if (!raw.length) throw new Error(`Faltan velas a partir de ${new Date(cursor).toISOString()}`);
  for (const row of raw) {
    if (row[0] >= end) continue;
    bars.push({ openTime: row[0], closeTime: row[0] + 60000,
      open: +row[1], high: +row[2], low: +row[3], close: +row[4], volume: +row[5] });
  }
  cursor = raw.at(-1)[0] + 60000;
  if (bars.length % 30000 === 0) console.log(`${bars.length} velas descargadas`);
}
const funding = [];
for (let cursor = start; cursor < end;) {
  const rows = await request('/fapi/v1/fundingRate', { symbol: 'BTCUSDT', startTime: cursor, endTime: end - 1, limit: 1000 });
  if (!rows.length) break;
  funding.push(...rows.map(x => ({ fundingTime: +x.fundingTime, fundingRate: +x.fundingRate })));
  cursor = +rows.at(-1).fundingTime + 1;
}
const payload = { source: 'Binance USD-M BTCUSDT perpetual', from, to, downloadedAt: new Date().toISOString(), bars, funding };
const target = resolve(output);
await mkdir(dirname(target), { recursive: true });
await writeFile(target, JSON.stringify(payload));
console.log(`Guardado ${target}: ${bars.length} velas y ${funding.length} eventos de funding.`);

