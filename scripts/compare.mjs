import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { runBacktest, summarize } from '../lab/backtest.mjs';
import { DEFAULT_PARAMS } from '../lab/signals.mjs';

const [input, output = 'comparison-result.json'] = process.argv.slice(2);
if (!input) {
  console.error('Uso: node scripts/compare.mjs data/btcusdt-perp.json comparison-result.json');
  process.exit(2);
}
const bytes = await readFile(resolve(input));
const data = JSON.parse(bytes.toString('utf8'));
const variants = {
  A_baseline: { ...DEFAULT_PARAMS },
  B_dmi: { ...DEFAULT_PARAMS, dmiFilter: true },
};
const report = { source: data.source, from: data.from, to: data.to,
  inputSha256: createHash('sha256').update(bytes).digest('hex'), variants: {} };
for (const [name, params] of Object.entries(variants)) {
  const result = runBacktest(data.bars, data.funding, params);
  report.variants[name] = { summary: summarize(result), warmupEnd: result.warmupEnd, trades: result.trades };
}
await writeFile(resolve(output), JSON.stringify(report, null, 2));
console.log(JSON.stringify(Object.fromEntries(Object.entries(report.variants).map(([name, value]) => [name, value.summary])), null, 2));

