// @ts-check
const path = require('path');
const { Worker } = require('worker_threads');

/** @type {Worker | null} */
let worker = null;
let nextId = 1;
/** @type {Map<number, { resolve: (v: any) => void, reject: (e: Error) => void }>} */
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(path.join(__dirname, 'workers', 'tlsh-worker.js'));
  worker.on('message', ({ id, result, error }) => {
    const pend = pending.get(id);
    if (!pend) return;
    pending.delete(id);
    if (error) pend.reject(new Error(error));
    else pend.resolve(result);
  });
  worker.on('error', (err) => {
    const e = err instanceof Error ? err : new Error(String(err));
    for (const p of pending.values()) p.reject(e);
    pending.clear();
    worker = null; // next call will respawn
  });
  worker.on('exit', (code) => {
    if (code !== 0) {
      for (const p of pending.values()) p.reject(new Error(`TLSH worker exited with code ${code}`));
      pending.clear();
    }
    worker = null; // next call will respawn
  });
  return worker;
}

function computeTlshAsync(buffer) {
  return new Promise((resolve, reject) => {
    if (!buffer || buffer.length < 512) {
      resolve(null);
      return;
    }
    const id = nextId++;
    pending.set(id, { resolve, reject });
    try {
      const w = getWorker();
      // Convert buffer to latin1 string on main thread, then post to worker.
      // (postMessage will structured-clone the string; the original buffer is freed.)
      const latin1 = buffer.toString('latin1');
      w.postMessage({ id, latin1, minLength: 512 });
    } catch (err) {
      pending.delete(id);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

function shutdown() {
  if (worker) {
    worker.terminate();
    worker = null;
    for (const p of pending.values()) p.reject(new Error('TLSH pool shut down'));
    pending.clear();
  }
}

module.exports = { computeTlshAsync, shutdown };
