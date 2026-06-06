import { promises as fs } from 'fs';
import path from 'path';
import type { GamePlugin } from '../shared/types';

export const gta5: GamePlugin = {
  id: 'gta5',
  name: 'GTA V',
  description: 'Supports GTA 5 (Legacy v1.0-v1.43 and Enhanced Edition v2.0+)',
  supportedEditions: ['legacy', 'enhanced'],
  nexusModsUrl: 'https://www.nexusmods.com/gta5',
  modIoUrl: 'https://mod.io/g/gta-v',
  installRules: [
    { extensions: ['.asi', '.dll'], subdir: '.' },
    { extensions: ['.rpf'], subdir: 'update/x64/dlc' },
  ],

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
