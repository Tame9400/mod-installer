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
      size: 0,
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
