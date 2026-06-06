import type { GameState, GamePlugin } from '../shared/types';

declare global {
  interface Window {
    electronAPI: {
      invoke(channel: string, ...args: any[]): Promise<any>;
      on(channel: string, callback: (...args: any[]) => void): () => void;
    };
  }
}

const ipc = () => window.electronAPI;

export async function getPlugins(): Promise<GamePlugin[]> {
  return ipc() ? await ipc().invoke('get-plugins') : [];
}

export async function detectGame(folder: string): Promise<GameState | null> {
  if (!ipc()) return null;
  const result = await ipc().invoke('detect-game', folder);
  if (!result) return null;
  
  return { 
    pluginId: result.pluginId, 
    gameName: result.gameName, 
    installRoot: result.installRoot,
    modsFolder: result.modsFolder,
    version: result.version,
  };
}

export async function scanFolder(folder: string): Promise<string[]> {
  if (!ipc()) return [];
  return ipc().invoke('scan-folder', folder);
}

export async function openFilePicker(extensions: string[]): Promise<string[] | null> {
  if (!ipc()) return null;
  return ipc().invoke('open-file-dialog', extensions);
}

export async function selectFolderDialog(): Promise<string | null> {
  if (!ipc()) return null;
  return ipc().invoke('select-folder-dialog');
}

export async function getFileInfo(filePath: string): Promise<any | null> {
  if (!ipc()) return null;
  return ipc().invoke('read-file-info', filePath);
}

export async function installMod(modPath: string, modsFolder: string, pluginId?: string): Promise<{ success: boolean; filesAdded: string[]; installLocation: string } | null> {
  if (!ipc()) return null;
  try {
    const result = await ipc().invoke('install-mod', modPath, modsFolder, pluginId);
    return { 
      success: result.success === true, 
      filesAdded: result.filesAdded || [], 
      installLocation: result.installLocation || modsFolder 
    };
  } catch (error) {
    console.error('Failed to install mod:', error);
    return { success: false, filesAdded: [], installLocation: '' };
  }
}

export async function getInstalledMods(): Promise<any[]> {
  if (!ipc()) return [];
  return ipc().invoke('get-installed-mods');
}

export async function uninstallMod(modId: string): Promise<boolean> {
  if (!ipc()) return false;
  try {
    const result = await ipc().invoke('uninstall-mod', modId);
    return result.success ?? true;
  } catch (error) {
    console.error('Failed to uninstall mod:', error);
    return false;
  }
}

export async function toggleMod(modId: string, enabled: boolean): Promise<boolean> {
  if (!ipc()) return false;
  try {
    const result = await ipc().invoke('enable-mod', modId, enabled);
    return result.success ?? true;
  } catch (error) {
    console.error('Failed to toggle mod:', error);
    return false;
  }
}

export async function resolveConflict(modId: string): Promise<boolean> {
  if (!ipc()) return false;
  try {
    const result = await ipc().invoke('resolve-conflict', modId);
    return result.success ?? true;
  } catch (error) {
    console.error('Failed to resolve conflict:', error);
    return false;
  }
}

export async function detectAllGames(folders: string[]): Promise<GameState[]> {
  if (!ipc()) return [];
  try {
    const results: any[] = await ipc().invoke('detect-all-games', folders) || [];
    return results.map((r: any) => ({
      pluginId: r.pluginId,
      gameName: r.gameName,
      installRoot: r.installRoot,
      modsFolder: r.modsFolder,
      version: r.version,
    }));
  } catch {
    const results: GameState[] = [];
    for (const folder of folders) {
      try {
        const result = await detectGame(folder);
        if (result && !results.find(r => r.pluginId === result.pluginId)) {
          results.push(result);
        }
      } catch {}
    }
    return results;
  }
}

export async function updateModMetadata(modId: string, data: { name?: string; notes?: string }): Promise<boolean> {
  if (!ipc()) return false;
  try {
    const result = await ipc().invoke('update-mod-meta', modId, data);
    return result.success ?? true;
  } catch { return false; }
}

export async function checkForUpdatesApp(): Promise<{ available: boolean; version?: string; releaseNotes?: string; error?: string }> {
  if (!ipc()) return { available: false, error: 'IPC not available' };
  return ipc().invoke('check-for-updates');
}

export async function openExternalUrl(url: string): Promise<void> {
  if (ipc()) await ipc().invoke('open-external-url', url);
}

export async function downloadUpdate(): Promise<boolean> {
  if (!ipc()) return false;
  try {
    const result = await ipc().invoke('download-update');
    return result.success ?? false;
  } catch { return false; }
}

export function onInstallProgress(callback: (progress: { modPath: string; current: number; total: number; phase: string }) => void): () => void {
  if (!ipc()) return () => {};
  return ipc().on('install-progress', callback);
}

export function getConflicts(installedMods: any[]): { fileName: string; sourceMods: string[]; paths: string[] }[] {
  const fileMap = new Map<string, { modName: string; modId: string; filePath: string }[]>();
  for (const mod of installedMods) {
    if (!mod.filesAdded) continue;
    for (const f of mod.filesAdded) {
      const key = f.split('\\').pop() || f.split('/').pop() || f;
      if (!fileMap.has(key)) fileMap.set(key, []);
      fileMap.get(key)!.push({ modName: mod.name, modId: mod.id, filePath: f });
    }
  }
  const conflicts: { fileName: string; sourceMods: string[]; paths: string[] }[] = [];
  for (const [fileName, sources] of fileMap) {
    if (sources.length > 1) {
      conflicts.push({
        fileName,
        sourceMods: [...new Set(sources.map(s => s.modName))],
        paths: sources.map(s => s.filePath),
      });
    }
  }
  return conflicts;
}
