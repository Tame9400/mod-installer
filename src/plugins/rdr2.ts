import { promises as fs } from 'fs';
import path from 'path';
import type { GamePlugin } from '../shared/types';

export const rdr2: GamePlugin = {
  id: 'rdr2',
  name: 'Red Dead Redemption 2',
  description: 'Supports Red Dead Redemption 2 (PC native)',
  supportedEditions: ['enhanced'],
  nexusModsUrl: 'https://www.nexusmods.com/reddeadredemption2',
  modIoUrl: 'https://mod.io/g/reddeadredemption2',
  installRules: [],

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
