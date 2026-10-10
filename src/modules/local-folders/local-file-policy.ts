export const MAX_LOCAL_FILES = 100;
export const MAX_LOCAL_FILE_BYTES = 128 * 1024;
export const MAX_LOCAL_TOTAL_BYTES = 512 * 1024;
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
      (part) =>
        !part || part === '.' || part === '..' || excludedDirectories.has(part.toLowerCase()),
    )
  )
    return false;
  return true;
}
