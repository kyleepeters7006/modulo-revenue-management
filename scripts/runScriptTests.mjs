#!/usr/bin/env node
/**
 * Runs the script-style tests: every *.test.ts under tests/ and server/ that
 * asserts inline and prints its own summary rather than using vitest.
 *
 * These are executed with tsx, one process each, because several of them
 * connect to the database and call process.exit() on completion — behaviour
 * vitest treats as a failure.
 *
 * Exits non-zero if any script fails, so it can gate CI alongside vitest.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

function findTests(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (name === 'node_modules' || name === '.git') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) findTests(full, out);
    // *.vitest.ts belongs to the vitest runner, not here.
    else if (name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

const files = [...findTests('tests'), ...findTests('server')].sort();
if (files.length === 0) {
  console.error('No script-style tests found.');
  process.exit(1);
}

const CONCURRENCY = 4;
const results = [];

function run(file) {
  return new Promise((resolve) => {
    const child = spawn('npx', ['tsx', file], { env: process.env });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ file, code, out }));
  });
}

const queue = [...files];
const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
  while (queue.length) {
    const file = queue.shift();
    const r = await run(file);
    results.push(r);
    const summary = (r.out.match(/^.*\b\d+ passed.*$/m) || r.out.match(/^.*All \d+ .*passed.*$/m) || [''])[0].trim();
    console.log(`${r.code === 0 ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'} ${r.file}${summary ? '  —  ' + summary : ''}`);
  }
});
await Promise.all(workers);

const failed = results.filter((r) => r.code !== 0);
console.log(`\n${results.length - failed.length}/${results.length} script test files passed`);
for (const f of failed) {
  console.log(`\n\x1b[31m--- ${f.file} ---\x1b[0m\n${f.out.slice(-3000)}`);
}
process.exit(failed.length ? 1 : 0);
