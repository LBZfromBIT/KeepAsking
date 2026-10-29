import { dialog, BrowserWindow } from 'electron';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { decodeTextFile, MAX_ATTACHMENTS, type FileAttachment } from '../shared/files';

export async function pickTextFiles(win: BrowserWindow | null): Promise<FileAttachment[] | null> {
  const options = {
    title: '添加文件',
    properties: ['openFile', 'multiSelections'] as ('openFile' | 'multiSelections')[],
  };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths.length) return null;
  if (result.filePaths.length > MAX_ATTACHMENTS) throw new Error(`一次最多添加 ${MAX_ATTACHMENTS} 个文件`);
  const files: FileAttachment[] = [];
  for (const path of result.filePaths) {
    const bytes = await readFile(path);
    files.push(decodeTextFile(basename(path), bytes));
  }
  return files;
}
