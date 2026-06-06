---FILE: filesystem.ts---
import fs from 'fs';
import path from 'path';

export interface FileInfo {
  name: string;
  filePath: string;
  size: number;
  isDirectory: boolean;
}

export async function scanDirectory(dir: string): Promise<FileInfo[]> {
  try {
    const dirents = await fs.promises.readdir(dir, { withFileTypes: true });
    return dirents.map(e => ({
      name: e.name,
      filePath: path.join(dir, e.name),
      size: e.isDirectory() ? 0 : (e.size ?? 0),
      isDirectory: e.isDirectory(),
    }));
  } catch { return []; }
}

export async function statFile(filePath: string): Promise<{ size: number; mtime: string } | null> {
  try {
    const stats = await fs.promises.stat(filePath);
    return { size: stats.size, mtime: stats.mtime.toISOString() };
  } catch { return null; }
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true });
}

export async function copyFile(src: string, dest: string): Promise<void> {
  const dir = path.dirname(dest);
  await fs.promises.mkdir(dir, { recursive: true });
  const data = fs.readFileSync(src);
  await fs.promises.writeFile(dest, data);
}

export async function copyFileToDir(
  src: string,
  destDir: string,
  name?: string
): Promise<string[]> {
  const targetPath = path.join(destDir, name ?? path.basename(src));
  const dir = path.dirname(targetPath);
  await ensureDir(dir);
  const data = fs.readFileSync(src);
  await fs.promises.writeFile(targetPath, data);
  return [targetPath];
}

export async function writeJson<T>(filePath: string, data: T): Promise<void> {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const s = await fs.promises.readFile(filePath, 'utf-8');
    return JSON.parse(s) as T;
  } catch { return null; }
}


---FILE: ipc-handler.ts---
import { resolve } from 'path';

const prodPath = resolve(__dirname, '../../renderer/dist/index.html');

export function getMainWindowUrl(): string {
  const isDev = process.env.NODE_ENV === 'development' && !process.defaultApp;
  if (isDev) {
    return 'http://localhost:3000'; // Vite dev server during development
  }
  return `file://${prodPath}`;
}


---FILE: ipc-handlers.ts---
import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { loader } from './plugin-loader';
import * as fsutil from './filesystem';
import { extractZip } from './archive/zip';
import { cyberpunk2077 } from '../plugins/cyberpunk2077';
import { rdr2 } from '../plugins/rdr2';
import { gta5 } from '../plugins/gta5';

const userDataDir = path.join(process.env.APPDATA || process.env.HOME || '', 'ModInstaller');
const DEFAULT_MODS_DB_PATH = path.join(userDataDir, 'installed.json');

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
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

ipcMain.handle('open-file-dialog', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['multiSelections'],
    filters: [{ name: 'Mod Files', extensions: ['zip','rar','7z','pak','npk','rpf','asi','dll'] }],
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

ipcMain.handle('enable-mod', async (_event, modId: string) => {
  const mods = await loadModList();
  const mod = mods.find((m: any) => m.id === modId);
  if (mod) { mod.enabled = true; await saveModList(mods); }
  return { success: !!mod };
});

ipcMain.handle('disable-mod', async (_event, modId: string) => {
  const mods = await loadModList();
  const mod = mods.find((m: any) => m.id === modId);
  if (mod) { mod.enabled = false; await saveModList(mods); }
  return { success: !!mod };
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

ipcMain.handle('install-mod', async (_event, modPath: string, gameInstallRoot: string) => {
  try {
    const ext = path.extname(modPath).slice(1).toLowerCase();
    let filesAdded: string[] = [];

    if (ext === 'zip') {
      filesAdded = await extractZip(modPath, gameInstallRoot);
    } else if (['pak','npk','rpf'].includes(ext)) {
      filesAdded = await fsutil.copyFileToDir(modPath, gameInstallRoot, path.basename(modPath));
    } else if (['asi','dll'].includes(ext)) {
      const name = path.basename(modPath);
      filesAdded = await fsutil.copyFileToDir(modPath, gameInstallRoot, name);
    } else {
      return { success: false, error: `Unsupported extension .${ext}` };
    }

    const modRecord = {
      id: Buffer.from(modPath).toString('base64'),
      name: path.basename(modPath).replace(/\.([^.]+)$/,''),
      filePath: modPath,
      gamePlugin: 'gta5',
      filesAdded,
      enabled: true,
      installed: true,
      installDate: new Date().toISOString(),
    };

    const mods = await loadModList();
    mods.push(modRecord);
    await saveModList(mods);
    return { success: true, filesAdded };
  } catch (err: unknown) {
    return { success: false, error: String((err as Error).message || err) };
  }
});

ipcMain.handle('get-installed-mods', async () => await loadModList());

ipcMain.handle('uninstall-mod', async (_event, modId: string) => {
  const mods = await loadModList();
  const idx = mods.findIndex((m: any) => m.id === modId);
  if (idx < 0) return { success: false };
  const mod = mods[idx];
  if (mod.filesAdded) {
    for (const f of mod.filesAdded) {
      try { await fs.promises.unlink(f); } catch {}
    }
  }
  mods.splice(idx, 1);
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

ipcMain.handle('scan-folder', async (_event, dir: string) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.filter(e => e.isFile()).map(e => path.join(dir, e.name));
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });


---FILE: plugin-loader.ts---
import { GamePluginDef } from '../../shared/types';

export class PluginLoaderImpl {
  private plugins = new Map<string, GamePluginDef>();

  register(plugin: GamePluginDef) {
    this.plugins.set(plugin.id, plugin);
  }

  get(id: string): GamePluginDef | undefined {
    return this.plugins.get(id);
  }

  getAll(): GamePluginDef[] {
    return [...this.plugins.values()];
  }
}

export const loader = new PluginLoaderImpl();


---FILE: archive.ts---
import { promises as fs, PathLike } from 'fs';
import path from 'path';
import type { ReadStream, WriteStream } from 'fs';

/**
 * Extract .7z archives using the 7-zip command line tool,
 * falling back to attempting to find it in PATH or common install locations.
 * If not found, raises an error describing which executable is needed.
 */
export async function extractSevenZ(archivePath: string, destDir: string): Promise<string[]> {
  const [sevenZipExe, sevenZipArgs] = await find7zExecutable();

  // Ensure destination directory exists
  await fs.mkdir(destDir, { recursive: true });

  try {
    return new Promise((resolve, reject) => {
      const child = spawn(sevenZipExe, ['x', '-y', archivePath, `-o${destDir}`], {
        cwd: path.dirname(archivePath),
        shell: true,
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => { stdout += data.toString(); });
      child.stderr?.on('data', (data) => { stderr += data.toString(); });

      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`7z extraction failed (${code}): ${stderr}`));
        }
      });
    });
  } catch {
    throw new Error(
      '7-Zip is not installed. Please install 7-Zip from https://www.7-zip.org/ or install via package manager.'
    );
  }
}

/**
 * Extract a RAR archive (first generation) using unrar command line tool.
 * Falls back to the same search strategy as SevenZipExtractor.
 */
export async function extractRar(archivePath: string, destDir: string): Promise<string[]> {
  const [unrarExe] = await findUnrarExecutable();

  await fs.mkdir(destDir, { recursive: true });

  try {
    return new Promise((resolve, reject) => {
      const child = spawn(unrarExe, ['x', '-y', archivePath, destDir], { shell: true });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (d) => { stdout += d.toString(); });
      child.stderr?.on('data', (d) => { stderr += d.toString(); });

      child.on('close', (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(`unrar extraction failed (${code}): ${stderr}`));
      });
    });
  } catch {
    throw new Error(
      'UNRAR is not installed. Please install UNRAR from https://www.rarlab.com/ or via package manager.'
    );
  }
}

// Internal helpers to find external executables in common locations and PATH
async function find7zExecutable(): Promise<[string, string[]]> {
  const candidates = [
    'C:\\Program Files\\7-Zip\\7z.exe',
    // Common package manager paths ...
    '7z', // try PATH
  ];

  for (const c of candidates) {
    try {
      await fs.access(c);
      return [c, ['x', '-y']];
    } catch {/* no-op */}
  }

  return Promise.reject(new Error('7-Zip not found in any candidate location or PATH'));
}

async function findUnrarExecutable(): Promise<[string, string[]]> {
  const candidates = [
    'C:\\Program Files\\WinRAR\\unrar.exe',
    'C:\\Program Files (x86)\\WinRAR\\unrar.exe',
    // Common package manager paths ...
    'unrar', // try PATH
  ];

  for (const c of candidates) {
    try {
      await fs.access(c);
      return [c, ['x', '-y']];
    } catch {/* no-op */}
  }

  return Promise.reject(new Error('UNRAR not found in any candidate location or PATH'));
}


---FILE: extract.ts---
import { promises as fs } from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';

export async function extractZip(archivePath: string, destDir: string): Promise<string[]> {
  const zip = new AdmZip(archivePath);
  const entries = zip.getEntries();
  const extractedFiles: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const targetPath = path.join(destDir, entry.entryName);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, Buffer.from(entry.getData()));
    extractedFiles.push(targetPath);
  }

  return extractedFiles;
}

export async function enumerateZipEntries(archivePath: string): Promise<string[]> {
  const zip = new AdmZip(archivePath);
  return zip.getEntries().filter(e => !e.isDirectory).map(e => e.entryName);
}


---FILE: zip.ts---
import { createWriteStream, promises as fs, ReadStream } from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';

export async function extractZip(
  archivePath: string,
  destDir: string
): Promise<string[]> {
  const zip = new AdmZip(archivePath);
  const entries = zip.getEntries();
  const extractedFiles: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const targetPath = path.join(destDir, entry.entryName);
    const targetDir = path.dirname(targetPath);
    await fs.mkdir(targetDir, { recursive: true });
    const buf = entry.getData();
    await fs.writeFile(targetPath, Buffer.from(buf));
    extractedFiles.push(targetPath);
  }

  return extractedFiles;
}

export async function extractZipStream(
  archivePath: string,
  destDir: string,
  onProgress?: (extracted: number, total: number) => void
): Promise<string[]> {
  const zip = new AdmZip(archivePath);
  const entries = zip.getEntries();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.isDirectory) continue;
    const targetPath = path.join(destDir, entry.entryName);
    const targetDir = path.dirname(targetPath);
    await fs.mkdir(targetDir, { recursive: true });
    const buf = entry.getData();
    await fs.writeFile(targetPath, Buffer.from(buf));
    onProgress?.(i + 1, entries.length);
  }

  return [];
}

export async function enumerateZipEntries(archivePath: string): Promise<string[]> {
  const zip = new AdmZip(archivePath);
  return zip.getEntries().filter(e => !e.isDirectory).map(e => e.entryName);
}


---FILE: cyberpunk2077.ts---
import { promises as fs } from 'fs';
import path from 'path';
import { GamePlugin, GameState, Edition } from '../shared/types';

export const cyberpunk2077: GamePlugin = {
  id: 'cyberpunk2077',
  name: 'Cyberpunk 2077',
  description: 'Supports Cyberpunk 2077 (all versions including Phantom Liberty)',
  supportedEditions: ['legacy', 'enhanced'],

  async detect(folder: string): Promise<{ matched: boolean; version?: string; installRoot: string; modsFolder: string }> {
    try {
      const exePath = path.join(folder, 'bin', 'x64', 'Cyberpunk2077.exe');
      const r6Path = path.join(folder, 'r6');
      const archivePcPath = path.join(folder, 'archive', 'pc');
      
      const [exeExists, r6Exists, archiveExists] = await Promise.all([
        fs.access(exePath).then(() => true).catch(() => false),
        fs.access(r6Path).then(() => true).catch(() => false),
        fs.access(archivePcPath).then(() => true).catch(() => false),
      ]);

      if (!exeExists && !r6Exists) {
        return { matched: false, installRoot: '', modsFolder: '' };
      }

      let version = 'unknown';
      try {
        const exeStats = await fs.stat(exePath);
        version = exeStats.mtime?.toISOString().split('T')[0] || 'unknown';
      } catch {/* version unknown, that's ok */}

      return {
        matched: true,
        version,
        installRoot: folder,
        modsFolder: path.join(folder, 'Mods'),
      };
    } catch {
      return { matched: false, installRoot: '', modsFolder: '' };
    }
  },
};


---FILE: gta5.ts---
import { promises as fs } from 'fs';
import path from 'path';
import { GamePlugin } from '../shared/types';

export const gta5: GamePlugin = {
  id: 'gta5',
  name: 'GTA V',
  description: 'Supports GTA 5 (Legacy v1.0-v1.43 and Enhanced Edition v2.0+)',
  supportedEditions: ['legacy', 'enhanced'],

  async detect(folder: string): Promise<{ matched: boolean; version?: string; installRoot: string; modsFolder: string }> {
    try {
      const legacyExe = path.join(folder, 'Rockstar Games', 'GTA V', 'play_gta5.exe');
      const enhancedExe = path.join(folder, 'GTA5.exe'); // Enhanced Edition uses this in some locations
      const pc1Path = path.join(folder, 'update', 'x64', 'dlc', 'pc1', 'pc1.rpf');
      const scriptHookPath = path.join(folder, 'script_hook_v1_0.dll'); // Legacy edition marker
      
      const [legacyExeExists, enhancedExeExists] = await Promise.all([
        fs.access(legacyExe).then(() => true).catch(() => false),
        fs.access(enhancedExe).then(() => true).catch(() => false),
      ]);

      // Check for common GTA 5 file markers in parent dir
      const hasGtaFileMarker = async (file: string) => {
        try {
          const candidate = path.join(folder, file);
          await fs.access(candidate);
          return true;
        } catch { return false; }
      };

      const [pc1Exists, scriptHookExists] = await Promise.all([
        hasGtaFileMarker('update/x64/dlc/pc1/pc1.rpf'),
        hasGtaFileMarker('GTA5.exe'),
      ]);

      if (!pc1Exists && !scriptHookExists) return { matched: false, installRoot: '', modsFolder: '' };

      // Detect which edition (legacy vs enhanced) by checking for specific indicators
      let version = 'unknown';
      try {
        const gta5ExePath = path.join(folder, 'GTA5.exe');
        const fileStats = await fs.stat(gta5ExePath);
        version = new Date(fileStats.mtimeMs).toISOString().split('T')[0];
      } catch {/* version unknown */}

      return {
        matched: true,
        version,
        installRoot: folder,
        modsFolder: path.join(folder, 'Mods'),
      };
    } catch {
      return { matched: false, installRoot: '', modsFolder: '' };
    }
  },
};


---FILE: rdr2.ts---
import { promises as fs } from 'fs';
import path from 'path';
import { GamePlugin } from '../shared/types';

export const rdr2: GamePlugin = {
  id: 'rdr2',
  name: 'Red Dead Redemption 2',
  description: 'Supports Red Dead Redemption 2 (PC native)',
  supportedEditions: ['enhanced'],

  async detect(folder: string): Promise<{ matched: boolean; version?: string; installRoot: string; modsFolder: string }> {
    try {
      const exePath = path.join(folder, 'launchers', 'rdr2_scriptloader.exe');
      const gta5LauncherPath = path.join(folder, 'gta5.exe'); // sometimes named gta5 on some configs
      const rockstarGames = await fs.lstat(path.dirname(folder));
      
      if (rockstarGames?.isDirectory()) {
        return { matched: false, installRoot: '', modsFolder: '' };
      }

      const [rdr2LauncherExists, gta5Exists] = await Promise.all([
        fs.access(exePath).then(() => true).catch(() => false),
        fs.access(gta5LauncherPath).then(() => true).catch(() => false),
      ]);

      if (!rdr2LauncherExists && !gta5Exists) {
        return { matched: false, installRoot: '', modsFolder: '' };
      }

      return {
        matched: true,
        version: 'unknown',
        installRoot: folder,
        modsFolder: path.join(folder, 'Mods'),
      };
    } catch {
      return { matched: false, installRoot: '', modsFolder: '' };
    }
  },
};


---FILE: api.ts---
import { ipcRenderer } from 'electron';
import type { GameState, GamePlugin } from '../shared/types';

export async function getPlugins(): Promise<GamePlugin[]> {
  return ipcRenderer ? await ipcRenderer.invoke('get-plugins') : [];
}

export async function detectGame(folder: string): Promise<GameState | null> {
  if (!ipcRenderer) return null;
  const result = await ipcRenderer.invoke('detect-game', folder);
  if (!result) return null;
  
  let edition: 'legacy' | 'enhanced' | undefined;
  try {
    // Heuristic detection based on game type
    if (result.pluginId === 'gta5') {
      /* Will detect via version in Electron context */
    }
  } catch {}

  return { 
    pluginId: result.pluginId, 
    gameName: result.gameName, 
    installRoot: result.installRoot, 
    version: result.version,
    edition 
  };
}

export async function scanFolder(folder: string): Promise<string[]> {
  if (!ipcRenderer) return [];
  return ipcRenderer.invoke('scan-folder', folder);
}

export async function openFilePicker(extensions: string[]): Promise<string[] | null> {
  if (!ipcRenderer) return null;
  return ipcRenderer.invoke('open-file-dialog', extensions);
}

export async function selectFolderDialog(): Promise<string | null> {
  if (!ipcRenderer) return null;
  return ipcRenderer.invoke('select-folder-dialog');
}

export async function getFileInfo(filePath: string): Promise<any | null> {
  if (!ipcRenderer) return null;
  return ipcRenderer.invoke('read-file-info', filePath);
}

export async function installMod(modPath: string, gameInstallRoot: string): Promise<boolean> {
  if (!ipcRenderer) return false;
  try {
    const result = await ipcRenderer.invoke('install-mod', modPath, gameInstallRoot);
    return result.success ?? true;
  } catch (error) {
    console.error('Failed to install mod:', error);
    return false;
  }
}

export async function uninstallMod(modId: string): Promise<boolean> {
  if (!ipcRenderer) return false;
  try {
    const result = await ipcRenderer.invoke('uninstall-mod', modId);
    return result.success ?? true;
  } catch (error) {
    console.error('Failed to uninstall mod:', error);
    return false;
  }
}

export async function resolveConflict(modId: string): Promise<boolean> {
  if (!ipcRenderer) return false;
  try {
    const result = await ipcRenderer.invoke('resolve-conflict', modId);
    return result.success ?? true;
  } catch (error) {
    console.error('Failed to resolve conflict:', error);
    return false;
  }
}


---FILE: App.tsx---
import { useState, useEffect } from 'react';
import type { GameState, GamePlugin } from '../shared/types';

export function App() {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [plugins, setPlugins] = useState<GamePlugin[]>([]);
  const [activeTab, setActiveTab] = useState<'browser' | 'installed' | 'conflicts' | 'settings'>('browser');
  const [scanFolders, setScanFolders] = useState<string[]>(['C:/Program Files (x86)/Steam/steamapps/common', 'C:/GOG Galaxy/Games']);

  useEffect(() => {
    window.electron && window.electron.invoke('get-plugins').then((plist: GamePlugin[]) => setPlugins(plist));
  }, []);

  const handleScan = async () => {
    for (const folder of scanFolders) {
      try {
        const result = await window.electron?.invoke('detect-game', folder);
        if (result) {
          setGameState({ pluginId: result.pluginId, gameName: result.gameName, installRoot: result.installRoot });
          break;
        }
      } catch {}
    }
  };

  const getPluginName = (id: string) => plugins.find(p => p.id === id)?.name || id;

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <h1>ðŸ“¦ Universal Mod Installer</h1>
        {gameState && (
          <span style={styles.gameBadge}>Installed for: {gameState.gameName}</span>
        )}
      </header>

      <nav style={styles.nav}>
        {[
          { tab: 'browser' as const, label: 'Mod Browser', icon: 'ðŸ”' },
          { tab: 'installed' as const, label: 'Installed Mods', icon: 'ðŸ“‹' },
          { tab: 'conflicts' as const, label: 'Conflicts', icon: 'âš ï¸' },
          { tab: 'settings' as const, label: 'Settings', icon: 'âš™ï¸' },
        ].map(({ tab, label, icon }) => (
          <button key={tab} style={{ ...styles.tabBtn, ...(activeTab === tab ? styles.tabActive : {}) }} onClick={() => setActiveTab(tab)}>
            {icon} {label} ({tab === 'installed' ? 0 : tab === 'conflicts' ? 0 : ''})
          </button>
        ))}
      </nav>

      <main style={styles.content}>
        {activeTab === 'browser' && <ModBrowser gameState={gameState} plugins={plugins} />}
        {activeTab === 'installed' && <InstalledMods gameState={gameState} />}
        {activeTab === 'conflicts' && <ConflictPanel gameName={gameState?.gameName}/>}
        {activeTab === 'settings' && <SettingsPanel scanFolders={scanFolders} setScanFolders={setScanFolders} onScan={handleScan} plugins={plugins} />}
      </main>
    </div>
  );
}

function ModBrowser({ gameState, plugins }: { gameState: GameState | null; plugins: GamePlugin[] }) {
  const [mods, setMods] = useState<any[]>([]);
  const [selectedMod, setSelectedMod] = useState<any>(null);
  const [installing, setInstalling] = useState(false);

  const addModFile = async () => {
    // Open file picker via electron dialog
    const files = await window.electron?.invoke('open-file-dialog', ['.zip', '.rar', '.7z', '.pak']);
    if (files) setMods(prev => [...prev, ...files.map(f => ({ name: f.split('/').pop(), path: f, installed: false }))]);
  };

  const handleInstall = async (modPath: string) => {
    setInstalling(true);
    try {
      await window.electron?.invoke('install-mod', modPath, gameState?.installRoot);
      setMods(prev => prev.map(m => m.path === modPath ? {...m, installed: true} : m));
    } finally { setInstalling(false); setSelectedMod(null); }
  };

  return (
    <div style={styles.modBrowser}>
      <h2>Mod Browser</h2>
      {!gameState && <div style={styles.alert}>No game detected. Go to Settings to scan for games.</div>}
      <button style={styles.btn} onClick={addModFile}>ðŸ“ Add Mod Files (.zip, .rar, .7z, .pak)</button>
      {mods.map((mod, i) => (
        <div key={`${mod.path}-${i}`} style={{ ...styles.modCard, borderColor: mod.installed ? '#4caf50' : selectedMod?.path === mod.path ? '#2196f3' : '#555' }}>
          <div onClick={() => setSelectedMod(selectedMod?.path === mod.path ? null : mod)} style={styles.modInfo}>
            <strong>{mod.name}</strong>
            {selectedMod?.path === mod.path && (
              <div style={{ marginTop: 8 }}>
                {gameState && !mod.installed && (
                  <>
                    <p>Will install to: <code>{gameState.installRoot}</code></p>
                    <button style={{ ...styles.btn, backgroundColor: installing ? '#757575' : '#2196f3' }} onClick={() => handleInstall(mod.path)}>
                      {installing ? 'Installing...' : 'ðŸ“¥ Install'}
                    </button>
                  </>
                )}
                {mod.installed && <span style={{ color: '#4caf50' }}>âœ… Installed</span>}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function InstalledMods({ gameState }: { gameState: GameState | null }) {
  const [installed, setInstalled] = useState<any[]>([]);
  
  const handleUninstall = async (modId: string) => {
    await window.electron?.invoke('uninstall-mod', modId);
    setInstalled(prev => prev.filter(m => m.id !== modId));
  };

  if (!gameState) return <p style={styles.alert}>Select a game first.</p>;

  return (
    <div>
      <h2>Installed Mods for {gameState.gameName}</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr><th style={styles.th}>Priority</th><th style={styles.th}>Mod Name</th><th style={styles.th}>Status</th><th style={styles.th}>Actions</th></tr>
        </thead>
        <tbody>
          {installed.map(mod => (
            <tr key={mod.id}>
              <td style={styles.td}>{mod.priority}</td>
              <td style={styles.td}>{mod.name}</td>
              <td style={{ ...styles.td, color: mod.enabled ? '#4caf50' : '#f44336' }}>{mod.enabled ? 'Enabled' : 'Disabled'}</td>
              <td style={styles.td}>
                <button style={styles.btnSm} onClick={() => handleUninstall(mod.id)}>ðŸ—‘ï¸ Uninstall</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConflictPanel({ gameName }: { gameName?: string }) {
  const [conflicts, setConflicts] = useState<any[]>([]);
  
  const resolveConflict = async (modId: string) => {
    await window.electron?.invoke('resolve-conflict', modId);
  };

  if (!gameName) return <p style={styles.alert}>No game selected.</p>;

  return (
    <div>
      <h2>Conflicts in {gameName}</h2>
      {conflicts.length === 0 ? (
        <p style={{ color: '#4caf50' }}>âœ… No conflicts detected!</p>
      ) : conflicts.map((c, i) => (
        <div key={i} style={styles.conflictCard}>
          <strong>ðŸ”´ {c.fileName}</strong>
          {c.sourceMods.map(modId => (
            <div key={modId}><code>{modId}</code><button onClick={() => resolveConflict(modId)} style={styles.btnSm}>Select as winner</button></div>
          ))}
        </div>
      ))}
    </div>
  );
}

function SettingsPanel({ scanFolders, setScanFolders, onScan, plugins }: { scanFolders: string[]; setScanFolders: (f: string[]) => void; onScan: () => void; plugins: any[] }) {
  const [newFolder, setNewFolder] = useState('');

  const addFolder = async () => {
    if (!newFolder) return;
    const folder = await window.electron?.invoke('select-folder-dialog') || newFolder;
    if (folder && !scanFolders.includes(folder)) setScanFolders([...scanFolders, folder]);
  };

  const removeFolder = (idx: number) => setScanFolders(scanFolders.filter((_, i) => i !== idx));

  return (
    <div>
      <h2>Settings</h2>
      <section style={styles.section}>
        <h3>ðŸŽ® Game Plugins (built-in)</h3>
        {plugins.map(p => (
          <div key={p.id} style={{ padding: '4px 0' }}>âœ… {p.name} â€” {p.description}</div>
        ))}
      </section>
      <section style={styles.section}>
        <h3>ðŸ“‚ Scan Folders for Games</h3>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input value={newFolder} onChange={e => setNewFolder(e.target.value)} placeholder="C:/path/to/game" style={styles.input} />
          <button style={styles.btn} onClick={addFolder}>âž• Add</button>
        </div>
        {scanFolders.map((folder, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <code>{folder}</code>
            <button onClick={() => removeFolder(i)} style={styles.btnSm}>âœ•</button>
          </div>
        ))}
        <button style={{ ...styles.btn, backgroundColor: '#4caf50', marginTop: 8 }} onClick={onScan}>ðŸ” Scan Now</button>
      </section>
    </div>
  );
}

const styles = {
  app: { maxWidth: '1200px', margin: '0 auto', padding: '0 24px' },
  header: { background: '#16213e', padding: '16px 24px', borderBottom: '2px solid #0f3460' },
  gameBadge: { background: '#e94560', padding: '4px 12px', borderRadius: 4, marginLeft: 16 },
  nav: { display: 'flex', gap: 8, padding: '12px 0', borderBottom: '1px solid #333' },
  tabBtn: { background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: 16, padding: '8px 16px' },
  tabActive: { color: '#2196f3', borderBottom: '2px solid #2196f3' },
  content: { background: '#1a1a2e', minHeight: '70vh' },
  btn: { background: '#0f3460', color: '#fff', border: 'none', padding: '8px 16px', cursor: 'pointer', borderRadius: 4, fontSize: 14 },
  btnSm: { background: '#e94560', color: '#fff', border: 'none', padding: '4px 8px', cursor: 'pointer', borderRadius: 3, marginLeft: 8, fontSize: 12 },
  alert: { background: '#f44336', color: '#fff', padding: '12px 16px', borderRadius: 4, margin: '8px 0' },
  input: { flex: 1, padding: '8px 12px', border: '1px solid #444', borderRadius: 4, background: '#16213e', color: '#eee' },
  section: { marginBottom: 24 },
  conflictCard: { background: '#f44336', padding: 12, borderRadius: 4, margin: '8px 0' },
  th: { borderBottom: '1px solid #333', padding: '8px 12px', textAlign: 'left' as const },
  td: { borderBottom: '1px solid #222', padding: '8px 12px' },
  modBrowser: { padding: 16 },
  modCard: { border: '2px solid #555', borderRadius: 4, padding: 12, cursor: 'pointer', marginBottom: 8, background: '#16213e' },
  modInfo: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
} as const;

export default App;


---FILE: types.ts---
export interface ModInfo {
  id: string;
  name: string;
  author: string;
  version: string;
  size: number;
  description: string;
  filePath: string;
  gamePlugin: string;
  installDate?: string;
  enabled: boolean;
  priority: number;
  dependencies: string[];
  optionalDeps: string[];
  conflicts: string[];
  installed: boolean;
  filesAdded: string[];
  conflictFiles?: { targetPath: string; sourceMods: string[]; fileName: string; resolution?: 'first-wins' | 'manual' | 'none'; selectedByMod?: string }[];
}

export type PluginType = 'archive-patch' | 'file-copy' | 'archive-override' | 'hook-mod' | 'native-plugin';

export interface InstallRule {
  installDirs: string[];
  archivePaths?: { from: string; to: string }[];
  hookFile?: string;
  patchArchive?: string;
}

export type Edition = 'legacy' | 'enhanced';

export interface GameState {
  pluginId: string;
  gameName: string;
  installRoot: string;
  edition?: Edition;
  version?: string;
}

export type InstallStatus = 'new' | 'checking' | 'installing' | 'installed' | 'error' | 'rollback';

export interface GamePluginDef {
  id: string;
  name: string;
  description: string;
  supportedEditions: ('legacy' | 'enhanced')[];
}


