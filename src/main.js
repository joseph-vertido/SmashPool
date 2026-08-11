const { app, BrowserWindow, ipcMain, dialog } = require('electron/main');
const path = require('node:path');
const fs = require('node:fs/promises');

let mainWindow;
let stateWriteChain = Promise.resolve();

function dataPath() {
  return path.join(app.getPath('userData'), 'badminton-pool.json');
}

async function readState() {
  try {
    const raw = await fs.readFile(dataPath(), 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Unable to read state:', error);
    return null;
  }
}

function writeState(state) {
  const payload = JSON.stringify(state, null, 2);
  stateWriteChain = stateWriteChain
    .catch(() => undefined)
    .then(async () => {
      await fs.writeFile(dataPath(), payload, 'utf8');
      return { ok: true };
    });
  return stateWriteChain;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#07111f',
    title: 'SmashPool — Badminton Pari-Mutuel Manager',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  ipcMain.handle('state:load', readState);
  ipcMain.handle('state:save', (_event, state) => writeState(state));

  ipcMain.handle('ui:setZoom', (_event, factor) => {
    const zoom = Math.min(1.5, Math.max(0.7, Number(factor) || 1));
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.setZoomFactor(zoom);
    }
    return { ok: true, zoom };
  });

  ipcMain.handle('state:export', async (_event, state) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export tournament pool',
      defaultPath: 'badminton-pool.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    await fs.writeFile(result.filePath, JSON.stringify(state, null, 2), 'utf8');
    return { ok: true, filePath: result.filePath };
  });

  ipcMain.handle('settlement:exportCsv', async (_event, csv) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export settlement CSV',
      defaultPath: 'badminton-pool-settlement.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    await fs.writeFile(result.filePath, csv, 'utf8');
    return { ok: true, filePath: result.filePath };
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
