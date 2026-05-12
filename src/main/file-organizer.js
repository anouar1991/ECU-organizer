// @ts-check
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const db = require('./database');

function sanitize(value) {
  if (!value) return 'Unknown';
  return String(value)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 80);
}

function getArchiveRoot() {
  const stored = db.getSetting('archive_root');
  if (stored && stored.length > 0) return stored;
  const fallback = path.join(app.getPath('documents'), 'ECU_Archive');
  return fallback;
}

function setArchiveRoot(newPath) {
  if (!newPath || typeof newPath !== 'string') {
    return { success: false, error: 'Invalid path' };
  }
  if (!fs.existsSync(newPath)) {
    fs.mkdirSync(newPath, { recursive: true });
  }
  db.setSetting('archive_root', newPath);
  return { success: true, archiveRoot: newPath };
}

function applyMask(mask, metadata, fileName, kind, solutionLabel) {
  const ext = path.extname(fileName) || '.bin';
  const baseName = path.basename(fileName, ext);

  const resolvedKind = kind === 'solution' ? 'solution' : 'original';
  const kindFolder = resolvedKind === 'solution' ? 'SOLUTIONS' : 'ORIGINAL';

  const stageFromName =
    /stage[ _]?(\d+)/i.exec(baseName)?.[0] || /(STG|stg)\d+/i.exec(baseName)?.[0] || null;

  let solution;
  if (resolvedKind === 'original') {
    solution = 'ORIGINAL';
  } else if (solutionLabel && String(solutionLabel).trim().length > 0) {
    solution = sanitize(solutionLabel);
  } else {
    solution = stageFromName ? sanitize(stageFromName) : 'MOD';
  }

  let stage;
  if (resolvedKind === 'solution' && solutionLabel && String(solutionLabel).trim().length > 0) {
    stage = sanitize(solutionLabel);
  } else if (resolvedKind === 'solution') {
    stage = stageFromName ? sanitize(stageFromName) : 'MOD';
  } else {
    stage = stageFromName ? sanitize(stageFromName) : 'STOCK';
  }

  const replacements = {
    '[BRAND]': sanitize(metadata.brand),
    '[MODEL]': sanitize(metadata.model),
    '[ECU]': sanitize(metadata.ecuType),
    '[HW]': sanitize(metadata.hwId || 'NOHW'),
    '[SW]': sanitize(metadata.swId || 'NOSW'),
    '[STAGE]': stage,
    '[KIND]': kindFolder,
    '[SOLUTION]': solution,
    '[ORIG]': sanitize(baseName),
    '[DATE]': new Date().toISOString().slice(0, 10).replace(/-/g, ''),
    '[PROTOCOL]': sanitize(
      Array.isArray(metadata.protocol) ? metadata.protocol[0] : metadata.protocol
    )
  };

  let result = mask;
  for (const [token, value] of Object.entries(replacements)) {
    result = result.split(token).join(value);
  }

  if (!path.extname(result)) result += ext;
  return result;
}

async function organize({
  filePath,
  fileName,
  fileSize,
  metadata,
  formatMask,
  kind,
  solutionLabel
}) {
  if (!fs.existsSync(filePath)) {
    return { success: false, error: 'Source file not found' };
  }

  const resolvedKind = kind === 'solution' ? 'solution' : 'original';
  const resolvedSolutionLabel = solutionLabel || '';

  const archiveRoot = getArchiveRoot();
  const brandDir = sanitize(metadata.brand);
  const modelDir = sanitize(metadata.model);
  const ecuDir = sanitize(metadata.ecuFamily || metadata.ecuType);
  const kindDir = resolvedKind === 'solution' ? 'SOLUTIONS' : 'ORIGINAL';

  const targetDir = path.join(archiveRoot, brandDir, modelDir, ecuDir, kindDir);
  fs.mkdirSync(targetDir, { recursive: true });

  const mask =
    formatMask && formatMask.length > 0 ? formatMask : '[BRAND]_[MODEL]_[HW]_[STAGE].bin';
  let newName = applyMask(mask, metadata, fileName, resolvedKind, resolvedSolutionLabel);

  let targetPath = path.join(targetDir, newName);
  let counter = 1;
  const ext = path.extname(newName);
  const base = path.basename(newName, ext);
  while (fs.existsSync(targetPath)) {
    newName = `${base}_${counter}${ext}`;
    targetPath = path.join(targetDir, newName);
    counter++;
    if (counter > 999) return { success: false, error: 'Too many duplicate file names' };
  }

  fs.copyFileSync(filePath, targetPath);

  return {
    success: true,
    archivePath: targetPath,
    newName,
    folder: targetDir
  };
}

module.exports = { organize, getArchiveRoot, setArchiveRoot };
