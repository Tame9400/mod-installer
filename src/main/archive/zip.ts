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
  const extractedFiles: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.isDirectory) continue;
    const targetPath = path.join(destDir, entry.entryName);
    const targetDir = path.dirname(targetPath);
    await fs.mkdir(targetDir, { recursive: true });
    const buf = entry.getData();
    await fs.writeFile(targetPath, Buffer.from(buf));
    extractedFiles.push(targetPath);
    onProgress?.(i + 1, entries.length);
  }

  return extractedFiles;
}

export async function enumerateZipEntries(archivePath: string): Promise<string[]> {
  const zip = new AdmZip(archivePath);
  return zip.getEntries().filter(e => !e.isDirectory).map(e => e.entryName);
}
