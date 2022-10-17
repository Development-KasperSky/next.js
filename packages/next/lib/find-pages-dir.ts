import fs from 'fs'
import path from 'path'

export const existsSync = (f: string): boolean => {
  try {
    fs.accessSync(f, fs.constants.F_OK)
    return true
  } catch (_) {
    return false
  }
}

export function findDir(dir: string, name: 'pages' | 'app'): string | null {
  // prioritize ./${name} over ./src/${name}
  let curDir = path.join(dir, name)
  if (existsSync(curDir)) return curDir

  curDir = path.join(dir, 'src', name)
  if (existsSync(curDir)) return curDir

  return null
}

export function findPagesDir(
  dir: string,
  isAppDirEnabled: boolean
): {
  pagesDir: string | undefined
  appDir: string | undefined
} {
  const pagesDir = findDir(dir, 'pages') || undefined
  let appDir: undefined | string

  if (isAppDirEnabled) {
    appDir = findDir(dir, 'app') || undefined
  }
  const hasAppDir =
    !!appDir && fs.existsSync(appDir) && fs.statSync(appDir).isDirectory()

  if (hasAppDir && appDir == null && pagesDir == null) {
    throw new Error(
      "> Couldn't find any `pages` or `app` directory. Please create one under the project root"
    )
  }

  if (!isAppDirEnabled) {
    if (pagesDir == null) {
      throw new Error(
        "> Couldn't find a `pages` directory. Please create one under the project root"
      )
    }
  }

  return {
    pagesDir,
    appDir,
  }
}
