// @ts-check
const { parentPort } = require('worker_threads');
const tlshHash = require('tlsh');

if (!parentPort) {
  throw new Error('tlsh-worker.js must be run as a worker thread');
}

parentPort.on('message', ({ id, latin1, minLength }) => {
  try {
    if (!latin1 || latin1.length < (minLength || 512)) {
      parentPort.postMessage({ id, result: null });
      return;
    }
    const digest = tlshHash(latin1);
    parentPort.postMessage({ id, result: digest });
  } catch (err) {
    parentPort.postMessage({ id, error: err.message });
  }
});
