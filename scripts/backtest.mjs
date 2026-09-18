import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { runBacktest, summarize } from '../lab/backtest.mjs';
import { V21_PARAMS } from '../lab/signals.mjs';

const [input, output = 'backtest-result.json'] = process.argv.slice(2);
if (!input) {
  console.error('Uso: npm run backtest -- data/btcusdt-perp.json backtest-result.json');
  process.exit(2);
}
const bytes = await readFile(resolve(input));
const data = JSON.parse(bytes.toString('utf8'));
const result = runBacktest(data.bars, data.funding, V21_PARAMS);
const report = { source: data.source, from: data.from, to: data.to,
  inputSha256: createHash('sha256').update(bytes).digest('hex'), summary: summarize(result), ...result };
await writeFile(resolve(output), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.summary, null, 2));
console.log(`Informe guardado en ${resolve(output)}`);
