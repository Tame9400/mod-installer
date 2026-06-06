import { promises as fs } from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';

export async function extractZip(archivePath: string, destDir: string): Promise<string[]> {
  const zip = new AdmZip(archivePath);
  const entries = zip.getEntries();
  const extractedFiles: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const targetPath = path.join(destDir, entry.entryName);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, Buffer.from(entry.getData()));
    extractedFiles.push(targetPath);
  }

  return extractedFiles;
}

export async function enumerateZipEntries(archivePath: string): Promise<string[]> {
  const zip = new AdmZip(archivePath);
  return zip.getEntries().filter(e => !e.isDirectory).map(e => e.entryName);
}
