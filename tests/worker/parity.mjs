// Shared helpers for proving the Worker port matches the Python reference implementation.
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const rules = JSON.parse(readFileSync(join(root, 'simulation/rules-v0.2.json'), 'utf8'));

export function python() {
  if (process.env.SX_PYTHON) return process.env.SX_PYTHON;
  const venv = join(root, '.venv/bin/python');
  return existsSync(venv) ? venv : 'python3';
}

export function runPython(script, args = []) {
  return JSON.parse(execFileSync(python(), [join(root, script), ...args.map(String)], {maxBuffer: 1 << 30, cwd: root}));
}

// Exact structural equality on parsed JSON. Numbers must be bit-identical, except that
// Python's -0.0 and 0 compare equal, as they do in Python.
export function diff(actual, expected, path = '$') {
  if (typeof expected === 'number' && typeof actual === 'number') {
    return actual === expected ? null : `${path}: ${actual} !== ${expected}`;
  }
  if (expected === null || typeof expected !== 'object') {
    return actual === expected ? null : `${path}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return `${path}: expected array`;
    if (actual.length !== expected.length) return `${path}: length ${actual.length} !== ${expected.length}`;
    for (let i = 0; i < expected.length; i++) { const d = diff(actual[i], expected[i], `${path}[${i}]`); if (d) return d; }
    return null;
  }
  if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return `${path}: expected object`;
  const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
  for (const k of keys) {
    if (!(k in expected)) return `${path}.${k}: unexpected key`;
    if (!(k in actual)) return `${path}.${k}: missing key`;
    const d = diff(actual[k], expected[k], `${path}.${k}`); if (d) return d;
  }
  return null;
}

// Replays tie-break and roll outcomes recorded on the Python side, checking each request matches.
export class ReplayRng {
  constructor(calls) { this.calls = calls; this.i = 0; }
  next(method, args) {
    const call = this.calls[this.i++];
    if (!call) throw new Error(`unexpected RNG call ${method}`);
    if (call.method && call.method !== method) throw new Error(`RNG call ${this.i}: ${method} !== ${call.method}`);
    const d = diff(args, call.args ?? args);
    if (d) throw new Error(`RNG call ${this.i} (${method}) arguments differ: ${d}`);
    return structuredClone(call.value);
  }
  choice(seq) { return this.next('choice', [seq]); }
  choices(population, weights) { return this.next('choices', [population, weights]); }
  sample(population, k) { return this.next('sample', [population, k]); }
  done() { return this.i === this.calls.length; }
}
