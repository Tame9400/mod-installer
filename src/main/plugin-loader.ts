import { GamePluginDef } from '../shared/types';

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
