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

export type Edition = 'legacy' | 'enhanced';

export interface GameState {
  pluginId: string;
  gameName: string;
  installRoot: string;
  modsFolder: string;
  edition?: Edition;
  version?: string;
}

export type InstallStatus = 'new' | 'checking' | 'installing' | 'installed' | 'error' | 'rollback';

export interface InstallRule {
  extensions: string[];
  subdir: string;
}

export interface GamePluginDef {
  id: string;
  name: string;
  description: string;
  supportedEditions: ('legacy' | 'enhanced')[];
  nexusModsUrl?: string;
  modIoUrl?: string;
  installRules: InstallRule[];
  detect(folder: string): Promise<{ matched: boolean; version?: string; installRoot: string; modsFolder: string }>;
}

export interface GamePlugin extends GamePluginDef {}
