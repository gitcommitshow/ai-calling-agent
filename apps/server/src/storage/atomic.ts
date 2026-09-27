/**
 * File primitives for the JSON store: atomic single-file writes plus tolerant
 * reads. Every write serializes first, lands in a temp file next to the target,
 * and is renamed into place, so a reader never sees a half-written record.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, open, readdir, readFile, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

/** Write a record atomically. Leaves the previous file untouched on any failure. */
export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });

  const tempPath = join(dir, `.${basename(filePath)}.${randomUUID()}.tmp`);
  try {
    const handle = await open(tempPath, 'wx');
    try {
      await handle.writeFile(body, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

/** Read one record, or null when the file does not exist yet. */
export async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

/** Read every record in a folder. Temp files and other extensions are ignored. */
export async function readJsonDir<T>(dirPath: string): Promise<T[]> {
  let names: string[];
  try {
    names = await readdir(dirPath);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }

  const records: T[] = [];
  for (const name of names.sort()) {
    if (name.startsWith('.') || !name.endsWith('.json')) continue;
    const record = await readJson<T>(join(dirPath, name));
    if (record) records.push(record);
  }
  return records;
}

/** Remove a record file. Missing files are not an error. */
export async function removeFile(filePath: string): Promise<void> {
  await rm(filePath, { force: true });
}

/** List record file names in a folder, without the `.json` suffix. */
export async function listRecordIds(dirPath: string): Promise<string[]> {
  try {
    const names = await readdir(dirPath);
    return names
      .filter((name) => !name.startsWith('.') && name.endsWith('.json'))
      .map((name) => name.slice(0, -'.json'.length))
      .sort();
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}
