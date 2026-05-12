// @ts-check
const { autoUpdater } = require('electron-updater');
const { app } = require('electron');
const C = require('../shared/channels');

let mainWindowRef = null;
let configured = false;

function configure(mainWin) {
  mainWindowRef = mainWin;
  if (configured) return;
  configured = true;

  autoUpdater.autoDownload = false; // ask user before downloading
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = console;

  autoUpdater.on('error', (err) => {
    emit('error', { message: String(err && err.message ? err.message : err) });
  });
  autoUpdater.on('checking-for-update', () => emit('checking', {}));
  autoUpdater.on('update-available', (info) => emit('available', info));
  autoUpdater.on('update-not-available', (info) => emit('not-available', info));
  autoUpdater.on('download-progress', (p) => emit('progress', p));
  autoUpdater.on('update-downloaded', (info) => emit('downloaded', info));
}

function emit(event, payload) {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
  mainWindowRef.webContents.send(C.APP_UPDATE_EVENT, { event, payload });
}

async function checkForUpdates() {
  try {
    const result = await autoUpdater.checkForUpdates();
    return { ok: true, version: result?.updateInfo?.version };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

async function downloadUpdate() {
  try {
    await autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

function quitAndInstall() {
  autoUpdater.quitAndInstall();
}

function getCurrentVersion() {
  return app.getVersion();
}

module.exports = { configure, checkForUpdates, downloadUpdate, quitAndInstall, getCurrentVersion };
