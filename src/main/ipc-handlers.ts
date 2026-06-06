import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';
import * as path from 'path';
import * as fs from 'fs';
import { loader } from './plugin-loader';
import * as fsutil from './filesystem';
import { extractZipStream, enumerateZipEntries } from './archive/zip';
import { extractSevenZ, extractRar } from './archive/archive';
import { cyberpunk2077 } from '../plugins/cyberpunk2077';
import { rdr2 } from '../plugins/rdr2';
import { gta5 } from '../plugins/gta5';

const userDataDir = path.join(process.env.APPDATA || process.env.HOME || '', 'ModInstaller');
const DEFAULT_MODS_DB_PATH = path.join(userDataDir, 'installed.json');
const BACKUPS_DIR = path.join(userDataDir, 'backups');

let mainWindow: BrowserWindow | null = null;

function send(channel: string, ...args: any[]) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  
  const indexPath = path.join(__dirname, '../renderer/index.html');
  mainWindow.loadFile(indexPath);
  mainWindow.on('closed', () => { mainWindow = null; });
}

loader.register(cyberpunk2077);
loader.register(rdr2);
loader.register(gta5);

function getModsDBPath(): string { return DEFAULT_MODS_DB_PATH; }
async function loadModList(): Promise<Record<string, any>[]> {
  try {
    if (!fs.existsSync(getModsDBPath())) return [];
    const data = await fs.promises.readFile(getModsDBPath(), 'utf8');
    return JSON.parse(data);
  } catch (err: unknown) { console.error('Failed to load mod list:', err); return []; }
}
async function saveModList(mods: Record<string, any>[]): Promise<void> {
  await fs.promises.mkdir(path.dirname(getModsDBPath()), { recursive: true });
  await fs.promises.writeFile(getModsDBPath(), JSON.stringify(mods, null, 2));
}

async function backupExistingFiles(files: string[]): Promise<{ original: string; backup: string }[]> {
  const backups: { original: string; backup: string }[] = [];
  for (const filePath of files) {
    try {
      await fs.promises.access(filePath);
      const backupPath = path.join(BACKUPS_DIR, Buffer.from(filePath).toString('base64') + '.bak');
      await fs.promises.mkdir(path.dirname(backupPath), { recursive: true });
      await fs.promises.copyFile(filePath, backupPath);
      backups.push({ original: filePath, backup: backupPath });
    } catch {}
  }
  return backups;
}

async function rollbackInstall(filesAdded: string[], backups: { original: string; backup: string }[]) {
  for (const f of filesAdded) {
    try { await fs.promises.unlink(f); } catch {}
  }
  for (const b of backups) {
    try {
      await fs.promises.copyFile(b.backup, b.original);
      await fs.promises.unlink(b.backup);
    } catch {}
  }
}

function routeFile(entryName: string, rules: { extensions: string[]; subdir: string }[], installRoot: string, defaultDir: string): string {
  const ext = path.extname(entryName).toLowerCase();
  for (const rule of rules) {
    if (rule.extensions.includes(ext)) {
      return rule.subdir === '.' ? path.join(installRoot, entryName) : path.join(installRoot, rule.subdir, entryName);
    }
  }
  return path.join(defaultDir, entryName);
}

ipcMain.handle('get-plugins', async () => loader.getAll());

ipcMain.handle('detect-game', async (_event, folder: string) => {
  const plugins = loader.getAll();
  for (const plugin of plugins) {
    try {
      const result = await plugin.detect(folder);
      if (result.matched) {
        return { ...result, pluginId: plugin.id, gameName: plugin.name };
      }
    } catch { continue; }
  }
  return null;
});

ipcMain.handle('detect-all-games', async (_event, folders: string[]) => {
  const found: any[] = [];
  const seen = new Set<string>();
  for (const folder of folders) {
    for (const plugin of loader.getAll()) {
      if (seen.has(plugin.id)) continue;
      try {
        const result = await plugin.detect(folder);
        if (result.matched) {
          seen.add(plugin.id);
          found.push({ ...result, pluginId: plugin.id, gameName: plugin.name });
        }
      } catch {}
    }
  }
  return found;
});

ipcMain.handle('open-file-dialog', async (_event, extensions: string[]) => {
  if (!mainWindow) return null;
  const exts = extensions && extensions.length > 0
    ? extensions.map(e => e.replace(/^\./, ''))
    : ['zip','rar','7z','pak','npk','rpf','asi','dll'];
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['multiSelections'],
    filters: [{ name: 'Mod Files', extensions: exts }],
  });
  if (result.canceled) return null;
  return result.filePaths;
});

ipcMain.handle('select-folder-dialog', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('reorder-mod', async (_event, modId: string, direction: 'up' | 'down') => {
  const mods = await loadModList();
  const idx = mods.findIndex((m: any) => m.id === modId);
  if (idx < 0) return { success: false };
  const newIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (newIdx < 0 || newIdx >= mods.length) return { success: false };
  [mods[idx], mods[newIdx]] = [mods[newIdx], mods[idx]];
  await saveModList(mods);
  return { success: true };
});

ipcMain.handle('install-mod', async (_event, modPath: string, modsFolder: string, pluginId?: string) => {
  let filesAdded: string[] = [];
  let backups: { original: string; backup: string }[] = [];
  try {
    const ext = path.extname(modPath).slice(1).toLowerCase();
    const plugin = pluginId ? loader.get(pluginId) : null;
    const rules = plugin?.installRules || [];
    const installRoot = pluginId && plugin ? '' : ''; // computed from gameState later
    const defaultDir = modsFolder;

    await fsutil.ensureDir(modsFolder);

    if (ext === 'zip') {
      const entries = await enumerateZipEntries(modPath);

      // Compute destination paths using routes
      const potentialPaths = rules.length > 0
        ? entries.map(e => routeFile(e, rules, path.dirname(modsFolder), defaultDir))
        : entries.map(e => path.join(defaultDir, e));

      send('install-progress', { modPath, phase: 'backing-up', current: 0, total: potentialPaths.length });
      backups = await backupExistingFiles(potentialPaths);

      // Extract to temp dir then move files to routed locations
      const tempDir = path.join(path.dirname(modPath), `.tmp_${Date.now()}`);
      await fsutil.ensureDir(tempDir);

      send('install-progress', { modPath, phase: 'extracting', current: 0, total: entries.length });
      const rawFiles = await extractZipStream(modPath, tempDir, (current, total) => {
        send('install-progress', { modPath, phase: 'extracting', current, total });
      });

      for (const raw of rawFiles) {
        const relPath = path.relative(tempDir, raw);
        const destPath = rules.length > 0
          ? routeFile(relPath, rules, path.dirname(modsFolder), defaultDir)
          : path.join(defaultDir, relPath);
        await fsutil.ensureDir(path.dirname(destPath));
        await fs.promises.copyFile(raw, destPath);
        filesAdded.push(destPath);
        try { await fs.promises.unlink(raw); } catch {}
      }
      try { await fs.promises.rmdir(tempDir); } catch {}

    } else if (ext === 'rar') {
      send('install-progress', { modPath, phase: 'extracting', current: 0, total: 0 });
      filesAdded = await extractRar(modPath, defaultDir);
      backups = await backupExistingFiles(filesAdded);
    } else if (ext === '7z') {
      send('install-progress', { modPath, phase: 'extracting', current: 0, total: 0 });
      filesAdded = await extractSevenZ(modPath, defaultDir);
      backups = await backupExistingFiles(filesAdded);
    } else {
      const name = path.basename(modPath);
      const dest = path.join(defaultDir, name);
      send('install-progress', { modPath, phase: 'backing-up', current: 0, total: 1 });
      backups = await backupExistingFiles([dest]);
      send('install-progress', { modPath, phase: 'extracting', current: 0, total: 1 });
      filesAdded = await fsutil.copyFileToDir(modPath, defaultDir, name);
    }

    const modRecord = {
      id: Buffer.from(modPath).toString('base64'),
      name: path.basename(modPath).replace(/\.([^.]+)$/,''),
      notes: '',
      filePath: modPath,
      gamePlugin: pluginId || 'unknown',
      filesAdded,
      backups,
      enabled: true,
      installed: true,
      installDate: new Date().toISOString(),
    };

    const mods = await loadModList();
    mods.push(modRecord);
    await saveModList(mods);
    send('install-progress', { modPath, phase: 'done', current: 1, total: 1 });
    return { success: true, filesAdded, installLocation: defaultDir };
  } catch (err: unknown) {
    send('install-progress', { modPath, phase: 'error', current: 0, total: 0 });
    await rollbackInstall(filesAdded, backups);
    return { success: false, error: String((err as Error).message || err) };
  }
});

ipcMain.handle('read-file-info', async (_event, filePath: string) => {
  try {
    const stats = await fs.promises.stat(filePath);
    return { name: path.basename(filePath), filePath, size: stats.size, isDirectory: stats.isDirectory() };
  } catch { return null; }
});

ipcMain.handle('get-installed-mods', async () => await loadModList());

ipcMain.handle('uninstall-mod', async (_event, modId: string) => {
  const mods = await loadModList();
  const idx = mods.findIndex((m: any) => m.id === modId);
  if (idx < 0) return { success: false };
  const mod = mods[idx];

  if (mod.backups) {
    for (const b of mod.backups) {
      try {
        await fs.promises.copyFile(b.backup, b.original);
        await fs.promises.unlink(b.backup);
      } catch {}
    }
  }

  if (mod.filesAdded) {
    const dirsToClean = new Set<string>();
    for (const f of mod.filesAdded) {
      try {
        await fs.promises.unlink(f);
        dirsToClean.add(path.dirname(f));
      } catch {}
    }
    for (const dir of dirsToClean) {
      try {
        const remaining = await fs.promises.readdir(dir);
        if (remaining.length === 0) await fs.promises.rmdir(dir);
      } catch {}
    }
  }

  mods.splice(idx, 1);
  await saveModList(mods);
  return { success: true };
});

ipcMain.handle('enable-mod', async (_event, modId: string, enabled: boolean) => {
  const mods = await loadModList();
  const mod = mods.find((m: any) => m.id === modId);
  if (!mod) return { success: false };
  mod.enabled = enabled;
  await saveModList(mods);
  return { success: true };
});

ipcMain.handle('resolve-conflict', async (_event, modId: string) => {
  const mods = await loadModList();
  const mod = mods.find((m:any) => m.id === modId);
  if (mod && mod.conflictFiles) {
    mod.conflictFiles.forEach((c: any) => { c.resolution = 'manual'; c.selectedByMod = modId; });
    await saveModList(mods);
  }
  return { success: !!mod };
});

ipcMain.handle('update-mod-meta', async (_event, modId: string, data: { name?: string; notes?: string }) => {
  const mods = await loadModList();
  const mod = mods.find((m: any) => m.id === modId);
  if (!mod) return { success: false };
  if (data.name !== undefined) mod.name = data.name;
  if (data.notes !== undefined) mod.notes = data.notes;
  await saveModList(mods);
  return { success: true };
});

ipcMain.handle('scan-folder', async (_event, dir: string) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.filter(e => e.isFile()).map(e => path.join(dir, e.name));
});

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

ipcMain.handle('check-for-updates', async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    if (result && result.updateInfo && result.updateInfo.version) {
      const currentVersion = app.getVersion();
      if (result.updateInfo.version !== currentVersion) {
        return { available: true, version: result.updateInfo.version, releaseNotes: result.updateInfo.releaseNotes || '' };
      }
    }
    return { available: false };
  } catch {
    return { available: false, error: 'Update check failed' };
  }
});

ipcMain.handle('download-update', async () => {
  try {
    autoUpdater.downloadUpdate();
    return { success: true };
  } catch { return { success: false }; }
});

ipcMain.handle('open-external-url', async (_event, url: string) => {
  const { shell } = require('electron');
  await shell.openExternal(url).catch(() => {});

});

autoUpdater.on('update-downloaded', () => {
  autoUpdater.quitAndInstall();
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });