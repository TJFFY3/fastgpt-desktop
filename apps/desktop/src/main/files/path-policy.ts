/** Provides the path policy module for the desktop application. */
import { AppError, relativePathSchema } from '../../../../../packages/shared/src/index';
import { homedir } from 'node:os';
import { resolve, parse, sep } from 'node:path';
/** Performs safe Relative Path for this module. */
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
/** Performs assert No Path Collisions for this module. */
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
/** Performs excluded Workspace Path for this module. */
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
/** Performs assert Workspace Root for this module. */
export function assertWorkspaceRoot(root: string, credentialRoots: string[]): void {
  const path = resolve(root),
    home = resolve(homedir());
  /** Performs within for this module. */
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
