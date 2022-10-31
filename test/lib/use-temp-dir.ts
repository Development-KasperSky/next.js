import fs from 'fs-extra'
import os from 'os'
import path from 'path'

/**
 * Create a randomly-named directory in `os.tmpdir()`, await a function call,
 * and delete the directory when finished.
 */
export async function useTempDir(
  fn: (folder: string) => void | Promise<void>,
  mode?: string | number
) {
  const folder = path.join(os.tmpdir(), Math.random().toString(36).slice(2))
  await fs.mkdirp(folder)

  if (mode) {
    fs.chmod(folder, mode)
  }

  try {
    await fn(folder)
  } finally {
    await fs.remove(folder)
  }
}
