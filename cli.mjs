#!/usr/bin/env node
// Usage: node cli.mjs rows.json [--window-start YYYY-MM-DD]
import { readFileSync } from 'node:fs';
import { estimateBotTraffic } from './index.mjs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) { console.error('Usage: node cli.mjs rows.json [--window-start YYYY-MM-DD]'); process.exit(1); }
const at = args.indexOf('--window-start');
const windowStart = at >= 0 ? args[at + 1] : null;
const rows = JSON.parse(readFileSync(file, 'utf8'));
console.log(JSON.stringify(estimateBotTraffic(rows, { windowStart }), null, 2));
