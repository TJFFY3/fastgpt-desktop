/** Enforces the main-process filesystem safety boundary for workspace artifacts. */
/* 中文：在主进程中执行工作区文件及快照的文件系统安全校验。 */
import { AppError, relativePathSchema } from '../../../../../packages/shared/src/index';
import { homedir } from 'node:os';
import { resolve, parse, sep } from 'node:path';
/** Validates or normalizes untrusted input before it crosses this module boundary. */
/* 中文：在不可信输入进入模块前执行校验或规范化处理。 */
export function safeRelativePath(value: string): string {
  if (
    !relativePathSchema.safeParse(value).success ||
    value !== value.normalize('NFC') ||
    value
      .split('/')
      .some((p) => /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))
  )
    throw new AppError('UNSAFE_PATH', '文件路径不安全或名称有歧义');
  return value;
}
/** Validates or normalizes untrusted input before it crosses this module boundary. */
/* 中文：在不可信输入进入模块前执行校验或规范化处理。 */
export function assertNoPathCollisions(paths: string[]): void {
  const seen = new Set<string>();
  for (const path of paths) {
    const canonical = safeRelativePath(path).normalize('NFC').toLowerCase();
    if (seen.has(canonical)) throw new AppError('UNSAFE_PATH', '文件名称大小写或规范化冲突');
    seen.add(canonical);
  }
}
export const defaultExcludedNames = [
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.cache',
  '.ssh',
  '.aws',
  '.azure',
  '.config',
  '.kube',
  '.npm',
  '.gnupg',
  '.codex',
];
/** Implements one focused part of this module’s public responsibility. */
/* 中文：实现本模块职责中的一项具体操作。 */
export function excludedWorkspacePath(relativePath: string): boolean {
  return relativePath
    .split('/')
    .some(
      (part) =>
        defaultExcludedNames.includes(part.toLowerCase()) ||
        /^\.env(?:\.|$)/i.test(part) ||
        /^(id_rsa|id_ed25519|credentials|token)(\.|$)/i.test(part) ||
        /\.(pem|key|p12|pfx)$/i.test(part),
    );
}
/** Validates or normalizes untrusted input before it crosses this module boundary. */
/* 中文：在不可信输入进入模块前执行校验或规范化处理。 */
export function assertWorkspaceRoot(root: string, credentialRoots: string[]): void {
  const path = resolve(root),
    home = resolve(homedir());
  /** Implements one focused part of this module’s public responsibility. */
  /* 中文：实现本模块职责中的一项具体操作。 */
  const within = (parent: string) => path === parent || path.startsWith(parent + sep);
  if (
    path === parse(path).root ||
    path === home ||
    [
      '/System',
      '/Library',
      '/Applications',
      '/bin',
      '/sbin',
      '/usr',
      '/etc',
      '/private/etc',
      '/dev',
      '/proc',
      '/sys',
      ...credentialRoots.map((v) => resolve(v)),
    ].some(within) ||
    ['.ssh', '.aws', '.azure', '.kube', '.gnupg', '.codex'].some((p) => within(resolve(home, p)))
  )
    throw new AppError('UNSAFE_PATH', '不能选择系统、主目录或凭据目录');
}
