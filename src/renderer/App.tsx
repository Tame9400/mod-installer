import { useState, useEffect, useRef, useCallback } from 'react';
import { type GameState, type GamePlugin } from '../shared/types';
import { getPlugins, openFilePicker, installMod, uninstallMod, toggleMod, selectFolderDialog, getInstalledMods, detectAllGames, updateModMetadata, onInstallProgress, getConflicts, checkForUpdatesApp, openExternalUrl } from './api';

const ACCEPTED_DROP_EXTS = ['.zip', '.rar', '.7z', '.pak', '.npk', '.rpf', '.asi', '.dll'];

const themes = {
  dark: {
    app: { maxWidth: '1200px', margin: '0 auto', padding: '0 24px', background: '#1a1a2e', color: '#eee', minHeight: '100vh' },
    header: { background: '#16213e', padding: '16px 24px', borderBottom: '2px solid #0f3460' },
    content: { minHeight: '70vh' },
    card: { border: '2px solid #555', borderRadius: 4, padding: 12, cursor: 'pointer', marginBottom: 8, background: '#16213e' },
    input: { flex: 1, padding: '8px 12px', border: '1px solid #444', borderRadius: 4, background: '#16213e', color: '#eee' },
    nav: { display: 'flex', gap: 8, padding: '12px 0', borderBottom: '1px solid #333' },
    progress: { background: '#0f3460', borderBottom: '1px solid #333' },
  },
  light: {
    app: { maxWidth: '1200px', margin: '0 auto', padding: '0 24px', background: '#f5f5f5', color: '#222', minHeight: '100vh' },
    header: { background: '#e0e0e0', padding: '16px 24px', borderBottom: '2px solid #bbb' },
    content: { minHeight: '70vh' },
    card: { border: '2px solid #ccc', borderRadius: 4, padding: 12, cursor: 'pointer', marginBottom: 8, background: '#fff' },
    input: { flex: 1, padding: '8px 12px', border: '1px solid #ccc', borderRadius: 4, background: '#fff', color: '#222' },
    nav: { display: 'flex', gap: 8, padding: '12px 0', borderBottom: '1px solid #ccc' },
    progress: { background: '#e0e0e0', borderBottom: '1px solid #ccc' },
  },
};

type Theme = typeof themes.dark;

export function App() {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [allDetectedGames, setAllDetectedGames] = useState<GameState[]>([]);
  const [plugins, setPlugins] = useState<GamePlugin[]>([]);
  const [activeTab, setActiveTab] = useState<'browser' | 'installed' | 'conflicts' | 'settings'>('browser');
  const [scanFolders, setScanFolders] = useState<string[]>(['C:/Program Files (x86)/Steam/steamapps/common', 'C:/GOG Galaxy/Games']);
  const [installedCount, setInstalledCount] = useState(0);
  const [installProgress, setInstallProgress] = useState<{ modPath: string; phase: string; current: number; total: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const dropRef = useRef<HTMLDivElement>(null);
  const t: Theme = darkMode ? themes.dark : themes.light;
  const s = styles(t);

  useEffect(() => {
    getPlugins().then(setPlugins);
  }, []);

  useEffect(() => {
    if (gameState) {
      getInstalledMods().then(all => setInstalledCount(all.filter((m: any) => m.gamePlugin === gameState.pluginId).length));
    }
  }, [gameState]);

  useEffect(() => {
    const unsub = onInstallProgress(progress => {
      setInstallProgress(progress);
      if (progress.phase === 'done' || progress.phase === 'error') {
        setTimeout(() => setInstallProgress(null), 2000);
      }
    });
    return unsub;
  }, []);

  const handleScan = useCallback(async () => {
    const games = await detectAllGames(scanFolders);
    setAllDetectedGames(games);
    if (games.length > 0) {
      if (!gameState || !games.find(g => g.pluginId === gameState.pluginId)) {
        setGameState(games[0]);
      }
    }
  }, [scanFolders, gameState]);

  useEffect(() => {
    if (allDetectedGames.length === 0) return;
    if (!gameState) return;
    const stillDetected = allDetectedGames.find(g => g.pluginId === gameState.pluginId);
    if (!stillDetected) {
      setGameState(allDetectedGames[0] || null);
    }
  }, [allDetectedGames, gameState]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter(f => {
      const ext = '.' + f.name.split('.').pop()?.toLowerCase();
      return ACCEPTED_DROP_EXTS.includes(ext);
    });
    if (files.length === 0) return;
    const paths = files.map(f => (f as any).path).filter(Boolean);
    if (paths.length === 0) return;
    const installedMods = await getInstalledMods();
    setModBrowserMods(prev => {
      const existing = new Set(prev.map(m => m.path));
      const newMods = paths.filter(p => !existing.has(p)).map(p => {
        const dbEntry = installedMods.find((m: any) => m.filePath === p);
        return {
          name: p.split('\\').pop() || p.split('/').pop() || p,
          path: p,
          installed: !!dbEntry,
          id: dbEntry ? dbEntry.id : null,
          filesAdded: dbEntry ? dbEntry.filesAdded || [] : [],
          installLocation: dbEntry ? (dbEntry.filesAdded?.[0]?.substring(0, dbEntry.filesAdded[0].lastIndexOf('\\')) || '') : '',
        };
      });
      const skipped = paths.length - newMods.length;
      if (skipped > 0) alert(`${skipped} file(s) already in the list, skipped.`);
      return [...prev, ...newMods];
    });
  }, []);

  const [modBrowserMods, setModBrowserMods] = useState<any[]>([]);

  return (
    <div style={s.app} ref={dropRef}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}>
      <header style={s.header}>
        <h1>Universal Mod Installer</h1>
        {gameState && (
          <span style={s.gameBadge}>Installed for: {gameState.gameName}</span>
        )}
        {allDetectedGames.length > 1 && (
          <span style={{ marginLeft: 12 }}>
            <select value={gameState?.pluginId || ''} onChange={e => {
              const g = allDetectedGames.find(g => g.pluginId === e.target.value);
              if (g) setGameState(g);
            }} style={t.input}>
              {allDetectedGames.map(g => (
                <option key={g.pluginId} value={g.pluginId}>{g.gameName}</option>
              ))}
            </select>
          </span>
        )}
      </header>

      {dragOver && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(33,150,243,0.15)', border: '3px dashed #2196f3', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, color: '#2196f3' }}>
          Drop mod files here
        </div>
      )}

      <nav style={s.nav}>
        {[
          { tab: 'browser' as const, label: 'Mod Browser', icon: '\uD83D\uDD0D' },
          { tab: 'installed' as const, label: 'Installed Mods', icon: '\uD83D\uDCCB' },
          { tab: 'conflicts' as const, label: 'Conflicts', icon: '\u26A0\uFE0F' },
          { tab: 'settings' as const, label: 'Settings', icon: '\u2699\uFE0F' },
        ].map(({ tab, label, icon }) => (
          <button key={tab} style={{ ...s.tabBtn, ...(activeTab === tab ? s.tabActive : {}) }} onClick={() => setActiveTab(tab)}>
            {icon} {label} {tab === 'installed' ? `(${installedCount})` : ''}
          </button>
        ))}
      </nav>

      {installProgress && installProgress.phase !== 'done' && installProgress.phase !== 'error' && (
        <div style={{ padding: '8px 24px', ...t.progress }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13 }}>
            <span>{installProgress.phase === 'extracting' ? 'Extracting...' : installProgress.phase === 'backing-up' ? 'Backing up originals...' : 'Installing...'}</span>
            {installProgress.total > 0 && <span>{installProgress.current} / {installProgress.total}</span>}
          </div>
          {installProgress.total > 0 && (
            <div style={{ height: 6, background: '#333', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.round((installProgress.current / installProgress.total) * 100)}%`, background: '#4caf50', transition: 'width 0.2s' }} />
            </div>
          )}
        </div>
      )}

      <main style={{ ...t.content, minHeight: dragOver ? '30vh' : '70vh' }}>
        {activeTab === 'browser' && <ModBrowser gameState={gameState} mods={modBrowserMods} setMods={setModBrowserMods} t={t} />}
        {activeTab === 'installed' && <InstalledMods gameState={gameState} t={t} />}
        {activeTab === 'conflicts' && <ConflictPanel gameState={gameState} t={t} />}
        {activeTab === 'settings' && <SettingsPanel scanFolders={scanFolders} setScanFolders={setScanFolders} onScan={handleScan} plugins={plugins} t={t} darkMode={darkMode} onToggleTheme={() => setDarkMode(d => !d)} />}
      </main>
    </div>
  );
}

function ModBrowser({ gameState, mods, setMods, t }: { gameState: GameState | null; mods: any[]; setMods: (m: any[] | ((prev: any[]) => any[])) => void; t: Theme }) {
  const [selectedMod, setSelectedMod] = useState<any>(null);
  const [installing, setInstalling] = useState(false);
  const [plugins, setPlugins] = useState<GamePlugin[]>([]);
  const s = styles(t);

  useEffect(() => { getPlugins().then(setPlugins); }, []);

  const currentPlugin = plugins.find(p => p.id === gameState?.pluginId);

  const addModFile = async () => {
    const files = await openFilePicker(['.zip', '.rar', '.7z', '.pak']);
    if (!files) return;
    const installedMods = await getInstalledMods();
    setMods(prev => {
      const existingPaths = new Set(prev.map(m => m.path));
      const newMods = files
        .filter(f => !existingPaths.has(f))
        .map(f => {
          const dbEntry = installedMods.find((m: any) => m.filePath === f);
          return {
            name: f.split('/').pop() || f.split('\\').pop() || f,
            path: f,
            installed: !!dbEntry,
            id: dbEntry ? dbEntry.id : null,
            filesAdded: dbEntry ? dbEntry.filesAdded || [] : [],
            installLocation: dbEntry ? (dbEntry.filesAdded?.[0]?.substring(0, dbEntry.filesAdded[0].lastIndexOf('\\')) || '') : '',
          };
        });
      const skipped = files.length - newMods.length;
      if (skipped > 0) alert(`${skipped} file(s) already in the list, skipped.`);
      return [...prev, ...newMods];
    });
  };

  const handleInstall = async (modPath: string) => {
    const mod = mods.find(m => m.path === modPath);
    if (!mod) return;

    const installedMods = await getInstalledMods();
    const existing = installedMods.find((m: any) => m.filePath === modPath);
    if (existing) {
      const ok = confirm(`"${mod.name}" is already installed.\n\nInstalled: ${existing.installDate ? new Date(existing.installDate).toLocaleString() : 'Unknown'}\nFiles: ${(existing.filesAdded || []).length}\n\nClick OK to uninstall the old version and reinstall, or Cancel to keep it as-is.`);
      if (!ok) { setSelectedMod(null); return; }
      await uninstallMod(existing.id);
    }

    setInstalling(true);
    try {
      const result = await installMod(modPath, gameState?.modsFolder || gameState?.installRoot || '', gameState?.pluginId);
      if (result && result.success) {
        setMods(prev => prev.map(m => m.path === modPath ? {...m, installed: true, id: btoa(modPath), filesAdded: result.filesAdded, installLocation: result.installLocation} : m));
      }
    } finally { setInstalling(false); setSelectedMod(null); }
  };

  const handleUninstall = async (modPath: string) => {
    const mod = mods.find(m => m.path === modPath);
    if (!mod || !mod.id) return;
    const ok = await uninstallMod(mod.id);
    if (ok) setMods(prev => prev.filter(m => m.path !== modPath));
  };

  return (
    <div style={s.modBrowser}>
      <h2>Mod Browser</h2>
      {!gameState && <div style={s.alert}>No game detected. Go to Settings to scan for games.</div>}
      <button style={s.btn} onClick={addModFile}>{'\uD83D\uDCC1'} Add Mod Files (.zip, .rar, .7z, .pak)</button>
      <p style={{ fontSize: 12, color: '#666', marginTop: 4 }}>...or drag & drop mod files onto the window</p>
      {currentPlugin && (
        <div style={{ display: 'flex', gap: 8, margin: '8px 0' }}>
          {currentPlugin.nexusModsUrl && (
            <button style={{ ...s.btn, backgroundColor: '#da8e35' }} onClick={() => openExternalUrl(currentPlugin.nexusModsUrl!)}>
              {'\uD83D\uDD17'} Browse on NexusMods
            </button>
          )}
          {currentPlugin.modIoUrl && (
            <button style={{ ...s.btn, backgroundColor: '#1a6d96' }} onClick={() => openExternalUrl(currentPlugin.modIoUrl!)}>
              {'\uD83D\uDD17'} Browse on Mod.io
            </button>
          )}
        </div>
      )}
      {mods.map((mod, i) => (
        <div key={`${mod.path}-${i}`} style={{ ...t.card, borderColor: mod.installed ? '#4caf50' : selectedMod?.path === mod.path ? '#2196f3' : '#555' }}>
          <div onClick={() => setSelectedMod(selectedMod?.path === mod.path ? null : mod)} style={s.modInfo}>
            <strong>{mod.name}</strong>
            {selectedMod?.path === mod.path && (
              <div style={{ marginTop: 8 }}>
                {gameState && !mod.installed && (
                  <>
                    <p>Will install to: <code>{gameState.modsFolder || gameState.installRoot}</code></p>
                    <button style={{ ...s.btn, backgroundColor: installing ? '#757575' : '#2196f3' }} onClick={() => handleInstall(mod.path)}>
                      {installing ? 'Installing...' : '\uD83D\uDCE5 Install'}
                    </button>
                  </>
                )}
                {mod.installed && (
                  <div>
                    <span style={{ color: '#4caf50' }}>{'\u2705'} Installed</span>
                    <button style={{ ...s.btnSm, background: '#f44336', marginLeft: 8 }} onClick={(e) => { e.stopPropagation(); handleUninstall(mod.path); }}>{'\uD83D\uDDD1\uFE0F'} Uninstall</button>
                    <p style={{ fontSize: 13, color: '#888' }}>Location: <code>{mod.installLocation}</code></p>
                    {mod.filesAdded && mod.filesAdded.length > 0 && (
                      <div style={{ fontSize: 12, marginTop: 4 }}>
                        <strong>Files installed:</strong>
                        <ul style={{ margin: '4px 0 0 0', paddingLeft: 20 }}>
                          {mod.filesAdded.map((f: string, i: number) => (
                            <li key={i} style={{ wordBreak: 'break-all' }}>{f}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function InstalledMods({ gameState, t }: { gameState: GameState | null; t: Theme }) {
  const [installed, setInstalled] = useState<any[]>([]);
  const [editingMod, setEditingMod] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const s = styles(t);

  useEffect(() => {
    getInstalledMods().then(all => {
      if (gameState) {
        const exact = all.filter((m: any) => m.gamePlugin === gameState.pluginId);
        setInstalled(exact.length > 0 ? exact : all);
      } else {
        setInstalled(all);
      }
    });
  }, [gameState]);
  
  const handleUninstall = async (modId: string) => {
    const ok = await uninstallMod(modId);
    if (ok) setInstalled(prev => prev.filter(m => m.id !== modId));
  };

  const handleToggle = async (modId: string, enabled: boolean) => {
    const ok = await toggleMod(modId, enabled);
    if (ok) setInstalled(prev => prev.map(m => m.id === modId ? {...m, enabled} : m));
  };

  const startEdit = (mod: any) => {
    setEditingMod(mod.id);
    setEditName(mod.name || '');
    setEditNotes(mod.notes || '');
  };

  const saveEdit = async (modId: string) => {
    const ok = await updateModMetadata(modId, { name: editName, notes: editNotes });
    if (ok) {
      setInstalled(prev => prev.map(m => m.id === modId ? {...m, name: editName, notes: editNotes} : m));
    }
    setEditingMod(null);
  };

  if (!gameState) return <p style={s.alert}>Select a game first.</p>;

  return (
    <div>
      <h2>Installed Mods for {gameState.gameName}</h2>
      {installed.length === 0 ? (
        <p style={{ color: '#888' }}>No mods installed.</p>
      ) : (
        <div>
          <p style={{ fontSize: 13, color: '#888', marginBottom: 12 }}>{installed.length} mod(s) installed for {gameState.gameName}.</p>
          {installed.map((mod, idx) => (
            <div key={mod.id}
              draggable={editingMod !== mod.id}
              onDragStart={() => setDragIdx(idx)}
              onDragOver={e => { e.preventDefault(); }}
              onDrop={() => {
                if (dragIdx === null || dragIdx === idx) return;
                setInstalled(prev => {
                  const copy = [...prev];
                  const [moved] = copy.splice(dragIdx, 1);
                  copy.splice(idx, 0, moved);
                  return copy;
                });
                setDragIdx(null);
              }}
              style={{ ...t.card, borderColor: mod.enabled ? '#4caf50' : '#f44336', marginBottom: 8, cursor: editingMod === mod.id ? 'default' : 'grab' }}>
              {editingMod === mod.id ? (
                <div>
                  <input value={editName} onChange={e => setEditName(e.target.value)} style={{ ...t.input, marginBottom: 4 }} placeholder="Mod name" />
                  <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} style={{ ...t.input, minHeight: 50, resize: 'vertical' }} placeholder="Notes..." />
                  <div style={{ marginTop: 4, display: 'flex', gap: 4 }}>
                    <button style={{ ...s.btnSm, background: '#4caf50' }} onClick={() => saveEdit(mod.id)}>Save</button>
                    <button style={s.btnSm} onClick={() => setEditingMod(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <strong>{mod.name}</strong>
                      {gameState && mod.gamePlugin !== gameState.pluginId && (
                        <span style={{ marginLeft: 6, fontSize: 11, background: '#333', padding: '2px 6px', borderRadius: 3, color: '#aaa' }}>
                          {mod.gamePlugin || 'unknown game'}
                        </span>
                      )}
                      <button style={{ ...s.btnSm, background: '#0f3460', marginLeft: 6 }} onClick={() => startEdit(mod)}>Edit</button>
                      <span style={{ marginLeft: 8, fontSize: 12, color: mod.enabled ? '#4caf50' : '#f44336' }}>
                        {mod.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                      <p style={{ fontSize: 12, color: '#888', margin: '4px 0 0 0' }}>
                        Installed: {mod.installDate ? new Date(mod.installDate).toLocaleString() : 'Unknown'}
                      </p>
                      {mod.filesAdded && mod.filesAdded.length > 0 && (
                        <p style={{ fontSize: 12, color: '#666', margin: '2px 0 0 0' }}>
                          Location: {mod.filesAdded[0].substring(0, mod.filesAdded[0].lastIndexOf('\\'))}
                        </p>
                      )}
                      {mod.notes && (
                        <p style={{ fontSize: 12, color: '#aaa', margin: '4px 0 0 0', fontStyle: 'italic' }}>{mod.notes}</p>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button style={{ ...s.btnSm, background: mod.enabled ? '#757575' : '#4caf50' }} onClick={() => handleToggle(mod.id, !mod.enabled)}>
                        {mod.enabled ? '\u23F8\uFE0F Disable' : '\u25B6\uFE0F Enable'}
                      </button>
                      <button style={s.btnSm} onClick={() => handleUninstall(mod.id)}>{'\uD83D\uDDD1\uFE0F'} Uninstall</button>
                    </div>
                  </div>
                  {mod.filesAdded && mod.filesAdded.length > 0 && (
                    <div style={{ fontSize: 12, marginTop: 4, color: '#999' }}>
                      <strong>Files ({mod.filesAdded.length}):</strong>
                      <ul style={{ margin: '4px 0 0 0', paddingLeft: 20, maxHeight: 120, overflowY: 'auto' }}>
                        {mod.filesAdded.map((f: string, i: number) => (
                          <li key={i} style={{ wordBreak: 'break-all' }}>{f}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ConflictPanel({ gameState, t }: { gameState: GameState | null; t: Theme }) {
  const [conflicts, setConflicts] = useState<any[]>([]);
  const s = styles(t);

  useEffect(() => {
    if (!gameState) { setConflicts([]); return; }
    getInstalledMods().then(all => {
      const gameMods = all.filter((m: any) => m.gamePlugin === gameState.pluginId);
      setConflicts(getConflicts(gameMods));
    });
  }, [gameState]);

  if (!gameState) return <p style={s.alert}>No game selected.</p>;

  return (
    <div style={{ padding: 16 }}>
      <h2>File Conflicts in {gameState.gameName}</h2>
      {conflicts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ fontSize: 48, marginBottom: 8 }}>{'\u2705'}</p>
          <p style={{ color: '#4caf50', fontSize: 18 }}>No conflicts detected!</p>
          <p style={{ color: '#888', fontSize: 13 }}>All installed mods have unique file names.</p>
        </div>
      ) : (
        <div>
          <p style={{ color: '#ff9800', marginBottom: 12 }}>
            {'\u26A0\uFE0F'} {conflicts.length} conflicting file{conflicts.length !== 1 ? 's' : ''} found across installed mods.
          </p>
          {conflicts.map((c, i) => (
            <div key={i} style={{ background: '#332200', border: '1px solid #ff9800', borderRadius: 4, padding: 12, marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <strong style={{ color: '#ff9800' }}>{'\u26A0\uFE0F'} {c.fileName}</strong>
              </div>
              <p style={{ fontSize: 12, color: '#aaa', marginBottom: 4 }}>Installed by {c.sourceMods.length} mods:</p>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                {c.sourceMods.map((name: string, j: number) => (
                  <li key={j} style={{ color: '#eee', marginBottom: 4 }}>{name}</li>
                ))}
              </ul>
              <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
                <strong>Paths:</strong>
                {c.paths.map((p: string, j: number) => (
                  <div key={j} style={{ wordBreak: 'break-all' }}>{p}</div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsPanel({ scanFolders, setScanFolders, onScan, plugins, t, darkMode, onToggleTheme }: { scanFolders: string[]; setScanFolders: (f: string[]) => void; onScan: () => void; plugins: any[]; t: Theme; darkMode: boolean; onToggleTheme: () => void }) {
  const [newFolder, setNewFolder] = useState('');
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'available' | 'uptodate' | 'error'>('idle');
  const s = styles(t);

  const addFolder = async () => {
    if (!newFolder) return;
    const folder = await selectFolderDialog() || newFolder;
    if (folder && !scanFolders.includes(folder)) setScanFolders([...scanFolders, folder]);
  };

  const removeFolder = (idx: number) => setScanFolders(scanFolders.filter((_, i) => i !== idx));

  const [updateVersion, setUpdateVersion] = useState<string>('');

  const checkForUpdates = async () => {
    setUpdateStatus('checking');
    try {
      const result = await checkForUpdatesApp();
      if (result.available) {
        setUpdateStatus('available');
        setUpdateVersion(result.version || '');
      } else {
        setUpdateStatus('uptodate');
        setTimeout(() => setUpdateStatus('idle'), 3000);
      }
    } catch {
      setUpdateStatus('error');
      setTimeout(() => setUpdateStatus('idle'), 3000);
    }
  };

  const handleDownloadUpdate = async () => {
    try {
      const { downloadUpdate } = await import('./api');
      await downloadUpdate();
      setUpdateStatus('idle');
    } catch {}
  };

  return (
    <div>
      <h2>Settings</h2>
      <section style={s.section}>
        <h3>{'\uD83C\uDFAE'} Game Plugins (built-in)</h3>
        {plugins.map(p => (
          <div key={p.id} style={{ padding: '4px 0' }}>
            {'\u2705'} {p.name} {'\u2014'} {p.description}
            {p.nexusModsUrl && (
              <button style={s.btnSm} onClick={() => openExternalUrl(p.nexusModsUrl)}>
                {'\uD83D\uDD17'} NexusMods
              </button>
            )}
            {p.modIoUrl && (
              <button style={{ ...s.btnSm, background: '#1a6d96', marginLeft: 4 }} onClick={() => openExternalUrl(p.modIoUrl)}>
                {'\uD83D\uDD17'} Mod.io
              </button>
            )}
          </div>
        ))}
      </section>
      <section style={s.section}>
        <h3>{'\uD83D\uDCC2'} Scan Folders for Games</h3>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input value={newFolder} onChange={e => setNewFolder(e.target.value)} placeholder="C:/path/to/game" style={t.input} />
          <button style={s.btn} onClick={addFolder}>{'\u2795'} Add</button>
        </div>
        {scanFolders.map((folder, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <code>{folder}</code>
            <button onClick={() => removeFolder(i)} style={s.btnSm}>{'\u2715'}</button>
          </div>
        ))}
        <button style={{ ...s.btn, backgroundColor: '#4caf50', marginTop: 8 }} onClick={onScan}>{'\uD83D\uDD0D'} Scan Now</button>
      </section>
      <section style={s.section}>
        <h3>{'\uD83C\uDF09'} Theme</h3>
        <button style={s.btn} onClick={onToggleTheme}>{darkMode ? '\u2600\uFE0F Light Mode' : '\uD83C\uDF19 Dark Mode'}</button>
      </section>
      <section style={s.section}>
        <h3>{'\uD83D\uDD04'} Updates</h3>
        {updateStatus === 'available' ? (
          <div>
            <p style={{ color: '#4caf50', marginBottom: 8 }}>Update {updateVersion} available!</p>
            <button style={{ ...s.btn, backgroundColor: '#4caf50' }} onClick={handleDownloadUpdate}>{'\u2B07\uFE0F'} Download & Install</button>
          </div>
        ) : (
          <button style={s.btn} onClick={checkForUpdates} disabled={updateStatus === 'checking'}>
            {updateStatus === 'checking' ? 'Checking...' : updateStatus === 'uptodate' ? '\u2705 Up to date' : updateStatus === 'error' ? '\u274C Check failed' : '\uD83D\uDD0D Check for Updates'}
          </button>
        )}
      </section>
      <section style={s.section}>
        <h3>{'\uD83D\uDCC1'} App Data</h3>
        <p style={{ fontSize: 12, color: '#888' }}>Installed mods database and backups are stored at:</p>
        <code style={{ fontSize: 11, color: '#aaa' }}>%APPDATA%/ModInstaller/</code>
      </section>
    </div>
  );
}

const styles = (t: Theme) => ({
  app: t.app,
  header: t.header,
  gameBadge: { background: '#e94560', padding: '4px 12px', borderRadius: 4, marginLeft: 16 },
  nav: t.nav,
  tabBtn: { background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: 16, padding: '8px 16px' },
  tabActive: { color: '#2196f3', borderBottom: '2px solid #2196f3' },
  content: t.content,
  btn: { background: '#0f3460', color: '#fff', border: 'none', padding: '8px 16px', cursor: 'pointer', borderRadius: 4, fontSize: 14 },
  btnSm: { background: '#e94560', color: '#fff', border: 'none', padding: '4px 8px', cursor: 'pointer', borderRadius: 3, marginLeft: 8, fontSize: 12 },
  alert: { background: '#f44336', color: '#fff', padding: '12px 16px', borderRadius: 4, margin: '8px 0' },
  section: { marginBottom: 24 },
  modBrowser: { padding: 16 },
  modInfo: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
});

export default App;
