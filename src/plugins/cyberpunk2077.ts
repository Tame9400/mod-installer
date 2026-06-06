import { promises as fs } from 'fs';
import path from 'path';
import type { GamePlugin } from '../shared/types';

export const cyberpunk2077: GamePlugin = {
  id: 'cyberpunk2077',
  name: 'Cyberpunk 2077',
  description: 'Supports Cyberpunk 2077 (all versions including Phantom Liberty)',
  supportedEditions: ['legacy', 'enhanced'],
  nexusModsUrl: 'https://www.nexusmods.com/cyberpunk2077',
  modIoUrl: 'https://mod.io/g/cyberpunk2077',
  installRules: [
    { extensions: ['.archive'], subdir: 'archive/pc/mod' },
    { extensions: ['.lua'], subdir: 'r6/scripts' },
    { extensions: ['.reds'], subdir: 'r6/scripts' },
    { extensions: ['.json', '.yaml', '.yml'], subdir: 'r6/config' },
  ],

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
