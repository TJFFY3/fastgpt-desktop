/** Provides the safe file ops module for the desktop application. */
import { execFile } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  AppError,
  fileEntrySchema,
  type FileEntry,
} from '../../../../../packages/shared/src/index';
import { assertNoPathCollisions, safeRelativePath } from './path-policy';
/** Defines the file Fingerprint data shape used by this module. */
export type FileFingerprint = {
  sha256: string;
  size: number;
  device: string;
  inode: string;
  mtimeNs: string;
};
/** Defines the file Limits data shape used by this module. */
export type FileLimits = { maxEntries: number; maxFileBytes: number; maxTotalBytes: number };
const fingerprintSchema = z.strictObject({
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z
    .number()
    .int()
    .nonnegative()
    .max(100 * 1024 * 1024),
  device: z.string().regex(/^\d+$/),
  inode: z.string().regex(/^\d+$/),
  mtimeNs: z.string().regex(/^-?\d+$/),
});
const safeCodes = new Set([
  'UNSAFE_PATH',
  'SOURCE_CHANGED',
  'FILE_CONFLICT',
  'WORKSPACE_LIMIT',
  'INVALID_RANGE',
  'INVALID_INPUT',
  'SAFE_FILES_FAILED',
]);
/** Coordinates safe File Ops responsibilities for this module. */
export class SafeFileOps {
  constructor(private helperPath: string) {}
  /** Handles root within this module's workflow. */
  private async root(root: string): Promise<string[]> {
    if (process.platform === 'win32')
      throw new AppError('SAFE_FILES_UNAVAILABLE', '此平台安全文件操作尚不可用');
    const stat = await lstat(root, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new AppError('UNSAFE_PATH', '目录不能为链接或特殊文件');
    return [await realpath(root), String(stat.dev), String(stat.ino)];
  }
  /** Handles invoke within this module's workflow. */
  private invoke(args: string[], maxBuffer = 16 * 1024 * 1024): Promise<Buffer> {
    return new Promise((resolve, reject) =>
      execFile(
        this.helperPath,
        args,
        {
          encoding: 'buffer',
          shell: false,
          timeout: 120000,
          maxBuffer,
          env: { LANG: 'C', LC_ALL: 'C' },
        },
        (error, stdout, stderr) => {
          if (error) {
            const code = (stderr ?? Buffer.alloc(0)).toString('utf8').trim();
            const unavailable = (error as NodeJS.ErrnoException).code === 'ENOENT';
            reject(
              new AppError(
                unavailable
                  ? 'SAFE_FILES_UNAVAILABLE'
                  : safeCodes.has(code)
                    ? code
                    : 'SAFE_FILES_FAILED',
                unavailable ? '安全文件组件不可用' : '安全文件操作未完成，请检查文件和备份状态',
              ),
            );
          } else resolve(stdout);
        },
      ),
    );
  }
  /** Handles scan within this module's workflow. */
  async scan(root: string, limits: FileLimits): Promise<FileEntry[]> {
    if (
      ![limits.maxEntries, limits.maxFileBytes, limits.maxTotalBytes].every(
        (v) => Number.isSafeInteger(v) && v >= 0,
      ) ||
      limits.maxEntries > 10000 ||
      limits.maxFileBytes > 100 * 1024 * 1024 ||
      limits.maxTotalBytes > 1024 ** 3
    )
      throw new AppError('INVALID_INPUT', '文件限额无效');
    const result = await this.invoke([
      'scan',
      ...(await this.root(root)),
      String(limits.maxEntries),
      String(limits.maxFileBytes),
      String(limits.maxTotalBytes),
    ]);
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(result),
        entries = text.trim()
          ? text
              .trim()
              .split('\n')
              .map((v) => fileEntrySchema.parse(JSON.parse(v)))
          : [];
      assertNoPathCollisions(entries.map((e) => e.relativePath));
      return entries.sort((a, b) =>
        a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0,
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('UNSAFE_PATH', '文件清单格式无效');
    }
  }
  /** Handles copy Into within this module's workflow. */
  async copyInto(
    root: string,
    path: string,
    destination: string,
    limit: number,
  ): Promise<FileFingerprint> {
    safeRelativePath(path);
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > 100 * 1024 * 1024)
      throw new AppError('INVALID_INPUT', '文件限额无效');
    return fingerprintSchema.parse(
      JSON.parse(
        (
          await this.invoke(
            ['copy', ...(await this.root(root)), path, destination, String(limit)],
            4096,
          )
        ).toString('utf8'),
      ),
    );
  }
  /** Handles read within this module's workflow. */
  async read(root: string, path: string, offset: number, max: number): Promise<Uint8Array> {
    safeRelativePath(path);
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(max) ||
      max < 1 ||
      max > 65536
    )
      throw new AppError('INVALID_RANGE', '读取范围无效');
    return new Uint8Array(
      await this.invoke(
        ['read', ...(await this.root(root)), path, String(offset), String(max)],
        65536,
      ),
    );
  }
  /** Handles expected within this module's workflow. */
  private expected(value: FileFingerprint | null): string {
    if (!value) return 'absent';
    const v = fingerprintSchema.parse(value);
    return `${v.sha256}:${v.size}:${v.device}:${v.inode}:${v.mtimeNs}`;
  }
  /** Handles replace within this module's workflow. */
  async replace(
    root: string,
    path: string,
    source: string,
    expected: FileFingerprint | null,
    backups: string,
  ): Promise<{ backupKey: string | null; version: FileFingerprint }> {
    safeRelativePath(path);
    const backupKey = randomUUID(),
      tempName = `.fastgpt-${randomUUID()}`;
    const result = await this.invoke(
      [
        'replace',
        ...(await this.root(root)),
        path,
        source,
        this.expected(expected),
        backups,
        backupKey,
        tempName,
      ],
      4096,
    );
    return z
      .strictObject({ backupKey: z.string().uuid().nullable(), version: fingerprintSchema })
      .parse(JSON.parse(result.toString('utf8')));
  }
  /** Handles delete within this module's workflow. */
  async delete(
    root: string,
    path: string,
    expected: FileFingerprint,
    backups: string,
  ): Promise<{ backupKey: string }> {
    safeRelativePath(path);
    const result = await this.invoke(
      [
        'delete',
        ...(await this.root(root)),
        path,
        '-',
        this.expected(expected),
        backups,
        randomUUID(),
        `.fastgpt-${randomUUID()}`,
      ],
      4096,
    );
    return z
      .strictObject({ backupKey: z.string().uuid() })
      .parse(JSON.parse(result.toString('utf8')));
  }
}
