import { promises as fs } from 'fs';
import path from 'path';
import { spawn } from 'child_process';

async function walkDir(dir: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(d: string) {
    const entries = await fs.readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else files.push(full);
    }
  }
  await walk(dir);
  return files;
}

async function findInPath(name: string): Promise<string | null> {
  try {
    const result = await new Promise<string>((resolve, reject) => {
      const proc = spawn('where', [name], { shell: true });
      let out = '';
      proc.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
      proc.on('close', (code) => {
        if (code === 0) resolve(out.split('\n')[0].trim());
        else reject(new Error('not found'));
      });
      proc.on('error', reject);
    });
    return result || null;
  } catch { return null; }
}

async function find7zExecutable(): Promise<string> {
  const candidates = [
    'C:\\Program Files\\7-Zip\\7z.exe',
    'C:\\Program Files (x86)\\7-Zip\\7z.exe',
  ];
  for (const c of candidates) {
    try { await fs.access(c); return c; } catch {}
  }
  const fromPath = await findInPath('7z');
  if (fromPath) return fromPath;
  throw new Error('7-Zip not found. Install from https://www.7-zip.org/');
}

async function findUnrarExecutable(): Promise<string> {
  const candidates = [
    'C:\\Program Files\\WinRAR\\UnRAR.exe',
    'C:\\Program Files (x86)\\WinRAR\\UnRAR.exe',
  ];
  for (const c of candidates) {
    try { await fs.access(c); return c; } catch {}
  }
  const fromPath = await findInPath('unrar');
  if (fromPath) return fromPath;
  throw new Error('UNRAR not found. Install from https://www.rarlab.com/');
}

export async function extractSevenZ(archivePath: string, destDir: string): Promise<string[]> {
  const exe = await find7zExecutable();
  await fs.mkdir(destDir, { recursive: true });
  return new Promise((resolve, reject) => {
    const child = spawn(exe, ['x', '-y', `-o${destDir}`, archivePath], { shell: true });
    let stderr = '';
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', async (code) => {
      if (code !== 0) return reject(new Error(`7z failed (${code}): ${stderr}`));
      try { resolve(await walkDir(destDir)); } catch { resolve([]); }
    });
    child.on('error', reject);
  });
}

export async function extractRar(archivePath: string, destDir: string): Promise<string[]> {
  const exe = await findUnrarExecutable();
  await fs.mkdir(destDir, { recursive: true });
  return new Promise((resolve, reject) => {
    const child = spawn(exe, ['x', '-y', archivePath, `${destDir}\\`], { shell: true });
    let stderr = '';
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', async (code) => {
      if (code !== 0) return reject(new Error(`unrar failed (${code}): ${stderr}`));
      try { resolve(await walkDir(destDir)); } catch { resolve([]); }
    });
    child.on('error', reject);
  });
}
