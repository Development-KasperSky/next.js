#!/usr/bin/env node

const path = require('path')
const { readFile, readdir, writeFile } = require('fs/promises')
const { copy } = require('fs-extra')
const { execSync } = require('child_process')

const cwd = process.cwd()

;(async function () {
  try {
    let version = JSON.parse(
      await readFile(path.join(cwd, 'lerna.json'))
    ).version
    let gitref = process.argv.slice(2)[0]

    // Copy binaries to package folders, update version, and publish
    let nativePackagesDir = path.join(cwd, 'packages/next-swc/crates/napi/npm')
    let platforms = (await readdir(nativePackagesDir)).filter(
      (name) => !name.startsWith('.')
    )

    for (let platform of platforms) {
      try {
        let binaryName = `next-swc.${platform}.node`
        await copy(
          path.join(cwd, 'packages/next-swc/native', binaryName),
          path.join(nativePackagesDir, platform, binaryName)
        )
        let pkg = JSON.parse(
          await readFile(path.join(nativePackagesDir, platform, 'package.json'))
        )
        pkg.version = version
        await writeFile(
          path.join(nativePackagesDir, platform, 'package.json'),
          JSON.stringify(pkg, null, 2)
        )
        execSync(
          `npm publish ${path.join(
            nativePackagesDir,
            platform
          )} --access public ${
            gitref.includes('canary') ? ' --tag canary' : ''
          }`
        )
      } catch (err) {
        // don't block publishing other versions on single platform error
        console.error(`Failed to publish`, platform)
        throw err
      }
      // lerna publish in next step will fail if git status is not clean
      execSync(
        `git update-index --skip-worktree ${path.join(
          nativePackagesDir,
          platform,
          'package.json'
        )}`
      )
    }

    // Update name/version of wasm packages and publish
    let wasmDir = path.join(cwd, 'packages/next-swc/crates/wasm')
    for (let wasmTarget of ['web', 'nodejs']) {
      let wasmPkg = JSON.parse(
        await readFile(path.join(wasmDir, `pkg-${wasmTarget}/package.json`))
      )
      wasmPkg.name = `@next/swc-wasm-${wasmTarget}`
      wasmPkg.version = version

      await writeFile(
        path.join(wasmDir, `pkg-${wasmTarget}/package.json`),
        JSON.stringify(wasmPkg, null, 2)
      )
      execSync(
        `npm publish ${path.join(
          wasmDir,
          `pkg-${wasmTarget}`
        )} --access public ${gitref.includes('canary') ? ' --tag canary' : ''}`
      )
    }

    // Update optional dependencies versions
    let nextPkg = JSON.parse(
      await readFile(path.join(cwd, 'packages/next/package.json'))
    )
    for (let platform of platforms) {
      let optionalDependencies = nextPkg.optionalDependencies || {}
      optionalDependencies['@next/swc-' + platform] = version
      nextPkg.optionalDependencies = optionalDependencies
    }
    await writeFile(
      path.join(path.join(cwd, 'packages/next/package.json')),
      JSON.stringify(nextPkg, null, 2)
    )
    // lerna publish in next step will fail if git status is not clean
    execSync('git update-index --skip-worktree packages/next/package.json')
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
})()
