export const MAX_LOCAL_FILES = 100;
export const MAX_LOCAL_FILE_BYTES = 128 * 1024;
export const MAX_LOCAL_TOTAL_BYTES = 512 * 1024;
const extensions = new Set([
  'md',
  'txt',
  'rst',
  'csv',
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'json',
  'yaml',
  'yml',
  'toml',
  'py',
  'sql',
  'html',
  'css',
  'scss',
  'go',
  'rs',
  'java',
  'cs',
  'c',
  'cpp',
  'h',
  'rb',
  'php',
]);
const excludedDirectories = new Set([
  'node_modules',
  'vendor',
  'dist',
  'build',
  'coverage',
  '__pycache__',
  'venv',
  'target',
]);

export function allowedLocalPath(path: string): boolean {
  if (
    !path ||
    path.length > 450 ||
    path.includes('\\') ||
    Array.from(path).some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || char === ':',
    )
  )
    return false;
  const parts = path.split('/');
  if (
    parts.some(
      (part) => !part || part.startsWith('.') || excludedDirectories.has(part.toLowerCase()),
    )
  )
    return false;
  const name = parts[parts.length - 1]!.toLowerCase();
  if (
    /(^|[._-])(secret|secrets|credential|credentials|token|tokens|password|passwords|private)([._-]|$)/.test(
      name,
    )
  )
    return false;
  if (['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'composer.lock'].includes(name))
    return false;
  return extensions.has(name.split('.').pop() ?? '');
}
