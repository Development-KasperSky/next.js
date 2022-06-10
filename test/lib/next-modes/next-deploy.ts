import os from 'os'
import path from 'path'
import execa from 'execa'
import fs from 'fs-extra'
import { NextInstance } from './base'
import {
  TEST_PROJECT_NAME,
  TEST_TEAM_NAME,
  TEST_TOKEN,
} from '../../../scripts/reset-vercel-project.mjs'
import fetch from 'node-fetch'

export class NextDeployInstance extends NextInstance {
  private _cliOutput: string
  private _buildId: string

  public get buildId() {
    // get deployment ID via fetch since we can't access
    // build artifacts directly
    return this._buildId
  }

  public async setup() {
    await super.createTestDir({ skipInstall: true })

    // ensure Vercel CLI is installed
    try {
      const res = await execa('vercel', ['--version'])
      require('console').log(`Using Vercel CLI version:`, res.stdout)
    } catch (_) {
      require('console').log(`Installing Vercel CLI`)
      await execa('npm', ['i', '-g', 'vercel@latest'], {
        stdio: 'inherit',
      })
    }
    const vercelFlags = ['--scope', TEST_TEAM_NAME]
    const vercelEnv = { ...process.env, TOKEN: TEST_TOKEN }

    // create auth file in CI
    if (process.env.NEXT_TEST_JOB) {
      const vcConfigDir = path.join(os.homedir(), '.vercel')
      await fs.ensureDir(vcConfigDir)
      await fs.writeFile(
        path.join(vcConfigDir, 'auth.json'),
        JSON.stringify({ token: TEST_TOKEN })
      )
      vercelFlags.push('--global-config', vcConfigDir)
    }
    require('console').log(`Linking project at ${this.testDir}`)

    // link the project
    const linkRes = await execa(
      'vercel',
      ['link', '-p', TEST_PROJECT_NAME, '--confirm', ...vercelFlags],
      {
        cwd: this.testDir,
        env: vercelEnv,
      }
    )

    if (linkRes.exitCode !== 0) {
      throw new Error(
        `Failed to link project ${linkRes.stdout} ${linkRes.stderr} (${linkRes.exitCode})`
      )
    }
    require('console').log(`Deploying project at ${this.testDir}`)

    const additionalEnv = []

    for (const key of Object.keys(this.env || {})) {
      additionalEnv.push('--build-env')
      additionalEnv.push(`${key}=${this.env[key]}`)
      additionalEnv.push('--env')
      additionalEnv.push(`${key}=${this.env[key]}`)
    }

    const deployRes = await execa(
      'vercel',
      [
        'deploy',
        '--build-env',
        'NEXT_PRIVATE_TEST_MODE=1',
        '--build-env',
        'FORCE_RUNTIME_TAG=canary',
        '--build-env',
        'NEXT_TELEMETRY_DISABLED=1',
        ...additionalEnv,
        '--force',
        ...vercelFlags,
      ],
      {
        cwd: this.testDir,
        env: vercelEnv,
      }
    )

    if (deployRes.exitCode !== 0) {
      throw new Error(
        `Failed to deploy project ${linkRes.stdout} ${linkRes.stderr} (${linkRes.exitCode})`
      )
    }
    // the CLI gives just the deployment URL back when not a TTY
    this._url = deployRes.stdout
    this._parsedUrl = new URL(this._url)

    require('console').log(`Deployment URL: ${this._url}`)
    const buildIdUrl = `${this._url}${
      this.basePath || ''
    }/_next/static/__BUILD_ID`

    const buildIdRes = await fetch(buildIdUrl)

    if (!buildIdRes.ok) {
      require('console').error(
        `Failed to load buildId ${buildIdUrl} (${buildIdRes.status})`
      )
    }
    this._buildId = (await buildIdRes.text()).trim()

    require('console').log(`Got buildId: ${this._buildId}`)

    const cliOutputRes = await fetch(
      `https://vercel.com/api/v1/deployments/${this._parsedUrl.hostname}/events?builds=1&direction=backward`,
      {
        headers: {
          Authorization: `Bearer ${TEST_TOKEN}`,
        },
      }
    )

    if (!cliOutputRes.ok) {
      throw new Error(
        `Failed to get build output: ${await cliOutputRes.text()} (${
          cliOutputRes.status
        })`
      )
    }
    this._cliOutput = (await cliOutputRes.json())
      .map((line) => line.text || '')
      .join('\n')
  }

  public get cliOutput() {
    return this._cliOutput || ''
  }

  public async start() {
    // no-op as the deployment is created during setup()
  }

  public async patchFile(filename: string, content: string): Promise<void> {
    throw new Error('patchFile is not available in deploy test mode')
  }
  public async readFile(filename: string): Promise<string> {
    throw new Error('readFile is not available in deploy test mode')
  }
  public async deleteFile(filename: string): Promise<void> {
    throw new Error('deleteFile is not available in deploy test mode')
  }
  public async renameFile(
    filename: string,
    newFilename: string
  ): Promise<void> {
    throw new Error('renameFile is not available in deploy test mode')
  }
}
