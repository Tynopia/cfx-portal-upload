import { Browser, getInstalledBrowsers, install } from '@puppeteer/browsers'
import { AssetDetail, SearchResponse, Urls } from './types'
import { homedir } from 'os'
import { join } from 'path'

import * as core from '@actions/core'
import axios from 'axios'
import fs from 'fs'
import path from 'path'
import yazl from 'yazl'

/**
 * Get the cache directory for Puppeteer.
 * @returns {string} The cache directory.
 */
function getCacheDirectory(): string {
  return join(homedir(), '.cache', 'puppeteer')
}

/**
 * Prepare the Puppeteer environment by installing the necessary browser.
 * @returns {Promise<void>} Resolves when the environment is prepared.
 */
export async function preparePuppeteer(): Promise<void> {
  if (process.env.RUNNER_TEMP === undefined) {
    core.info('Running locally, skipping Puppeteer setup ...')
    return
  }

  const cacheDirectory = getCacheDirectory()
  const installed = await getInstalledBrowsers({
    cacheDir: cacheDirectory
  })

  if (!installed.some(browser => browser.browser === Browser.CHROME)) {
    core.info('Installing Chrome ...')
    await install({
      cacheDir: cacheDirectory,
      browser: Browser.CHROME,
      buildId: '131.0.6778.108'
    })
  }
}

export async function resolveAssetId(
  name: string,
  cookies: string
): Promise<string> {
  core.debug(`Searching asset id for ${name}...`)

  const search = await axios.get<SearchResponse>(
    `https://portal-api.cfx.re/v1/me/assets?search=${name}&sort=asset.name&direction=asc`,
    {
      headers: {
        Cookie: cookies
      }
    }
  )

  if (search.data.items.length == 0) {
    core.debug(JSON.stringify(search.data))
    throw new Error(
      `Failed to find asset id for "${name}". See debug logs for more information.`
    )
  }

  // Match the exact name
  for (const asset of search.data.items) {
    if (asset.name == name) {
      core.debug('Found asset id: ' + asset.id)
      return asset.id.toString()
    }
  }

  core.debug(JSON.stringify(search.data))
  throw new Error(
    `Failed to find asset id for "${name}" exact match. See debug logs for more information.`
  )
}

export function getUrl(
  type: keyof typeof Urls,
  params?: Record<string, string | number>
): string {
  let url = Urls.API + Urls[type]

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url = url.replace(`{${key}}`, String(value))
    }
  }

  return url
}

type TreeNode = string | Record<string, TreeNode[]> | null

function buildTree(currentPath: string): TreeNode {
  const stats = fs.statSync(currentPath)

  if (stats.isFile()) {
    return path.basename(currentPath) // Return file name
  }

  if (stats.isDirectory()) {
    const children = fs.readdirSync(currentPath)
    return {
      [path.basename(currentPath)]: children.map(child =>
        buildTree(path.join(currentPath, child))
      )
    }
  }

  return null
}

export function getEnv(name: string): string {
  if (process.env[name] === undefined) {
    throw new Error(`Environment variable ${name} is not set.`)
  }

  return process.env[name]
}

export async function zipAsset(assetName: string): Promise<string> {
  core.debug('Zipping asset...')

  const workspacePath = getEnv('GITHUB_WORKSPACE')
  const outputZipPath = assetName + '.zip'
  const zipfile = new yazl.ZipFile()

  function addDirectoryToZip(dir: string, zipPath: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      const entryZipPath = path.join(zipPath, entry.name)
      if (entry.isDirectory()) {
        core.debug(`Entering directory ${fullPath}...`)
        addDirectoryToZip(fullPath, entryZipPath)
      } else if (entry.isFile()) {
        core.debug(`Adding file ${fullPath} as ${entryZipPath}...`)
        zipfile.addFile(fullPath, entryZipPath, { compress: true })
      }
    }
  }

  core.debug('Adding files to zip...')
  addDirectoryToZip(workspacePath, assetName) // Use asset name as zip root folder

  core.debug(
    'Zip content: ' + JSON.stringify(buildTree(workspacePath), null, 2)
  )
  zipfile.end()

  const outputStream = fs.createWriteStream(outputZipPath)
  return new Promise((resolve, reject) => {
    zipfile.outputStream
      .pipe(outputStream)
      .on('close', () => {
        console.log(`Asset zipped to ${outputZipPath}`)
        resolve(path.resolve(outputZipPath))
      })
      .on('error', reject)
  })
}

export function deleteIfExists(_path: string): void {
  _path = path.join(getEnv('GITHUB_WORKSPACE'), _path)

  try {
    if (fs.existsSync(_path)) {
      core.debug(`Deleting ${_path}...`)
      const stats = fs.lstatSync(_path)

      if (stats.isDirectory()) {
        fs.rmSync(_path, { recursive: true, force: true })
      } else if (stats.isFile()) {
        fs.unlinkSync(_path)
      }
    } else {
      core.debug(`${_path} does not exist, skipping`)
    }
  } catch (error) {
    core.debug(`Skipping ${_path} deletion due to error: ${error as string}`)
  }
}

/**
 * Validates that fxmanifest.lua exists and has a version tag.
 * @throws If fxmanifest.lua is not found or does not have a version tag.
 */
export function validateFxManifest(): void {
  const workspacePath = getEnv('GITHUB_WORKSPACE')
  const manifestPath = path.join(workspacePath, 'fxmanifest.lua')

  if (!fs.existsSync(manifestPath)) {
    throw new Error('fxmanifest.lua not found in the workspace.')
  }

  const content = fs.readFileSync(manifestPath, 'utf8')
  const versionRegex = /^version\s+['"].*['"]/m
  if (!versionRegex.test(content)) {
    throw new Error("fxmanifest.lua does not have a `version '%s'` tag.")
  }
}

/**
 * Checks if fxmanifest.lua has a beta tag.
 * @returns {boolean} True if the beta tag is found.
 */
export function isBetaAsset(): boolean {
  const workspacePath = getEnv('GITHUB_WORKSPACE')
  const manifestPath = path.join(workspacePath, 'fxmanifest.lua')

  if (!fs.existsSync(manifestPath)) {
    return false
  }

  const content = fs.readFileSync(manifestPath, 'utf8')
  const betaRegex = /^beta\s+['"].*['"]/m
  return betaRegex.test(content)
}

/**
 * Extracts the version from fxmanifest.lua.
 * @returns {string} The version string.
 * @throws If fxmanifest.lua is not found or does not have a version tag.
 */
export function getFxManifestVersion(): string {
  const workspacePath = getEnv('GITHUB_WORKSPACE')
  const manifestPath = path.join(workspacePath, 'fxmanifest.lua')

  if (!fs.existsSync(manifestPath)) {
    throw new Error('fxmanifest.lua not found in the workspace.')
  }

  const content = fs.readFileSync(manifestPath, 'utf8')
  const versionRegex = /^version\s+['"](.*)['"]/m
  const match = content.match(versionRegex)

  if (!match || !match[1]) {
    throw new Error("fxmanifest.lua does not have a `version '%s'` tag.")
  }

  return match[1]
}

type CommitEvent = {
  head_commit?: { message?: string }
}

/**
 * Gets the commit message that triggered the action.
 * @returns {string} The commit message.
 */
export function getCommitMessage(): string {
  try {
    const eventPath = process.env.GITHUB_EVENT_PATH
    if (eventPath && fs.existsSync(eventPath)) {
      const eventData = JSON.parse(
        fs.readFileSync(eventPath, 'utf8')
      ) as CommitEvent

      if (eventData.head_commit && eventData.head_commit.message) {
        return eventData.head_commit.message
      }
    }
  } catch (error) {
    const _error = error instanceof Error ? error.message : String(error)

    core.debug(`Failed to get commit message from event payload: ${_error}`)
  }

  return 'No changelog provided'
}

/**
 * Gets the changelog based on inputs or commit message.
 * @returns {string} The changelog string.
 */
export function getChangelog(): string {
  const changelog = core.getInput('changelog')
  if (changelog) {
    return changelog
  }

  const changelogFile = core.getInput('changelogFile')
  if (changelogFile) {
    const workspacePath = getEnv('GITHUB_WORKSPACE')
    const fullPath = path.join(workspacePath, changelogFile)

    if (fs.existsSync(fullPath)) {
      return fs.readFileSync(fullPath, 'utf8')
    }

    core.warning(
      `Changelog file not found at ${fullPath}. Falling back to commit message.`
    )
  }

  return getCommitMessage()
}

/**
 * Fetches all versions for a given asset.
 * @param assetId The ID of the asset.
 * @param cookies The authentication cookies.
 * @returns {Promise<AssetVersion[]>} A list of asset versions.
 */
export async function getAssetVersions(
  assetId: string,
  cookies: string
): Promise<AssetDetail['versions']> {
  core.debug(`Fetching versions for asset ${assetId}...`)

  const response = await axios.get<AssetDetail>(
    getUrl('ASSET_DETAIL', { id: assetId }),
    {
      headers: {
        Cookie: cookies
      }
    }
  )

  return response.data.versions
}

/**
 * Placeholder for deleting an asset version.
 * @param assetId The ID of the asset.
 * @param versionId The ID of the version to delete.
 * @param cookies The authentication cookies.
 */
export async function deleteAssetVersion(
  assetId: string,
  versionId: number,
  cookies: string
): Promise<void> {
  core.info(`Deleting version ${versionId} of asset ${assetId}...`)

  await axios.delete(
    getUrl('DELETE_VERSION', { id: assetId, version_id: versionId }),
    {
      headers: {
        Cookie: cookies
      }
    }
  )
}
