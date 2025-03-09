import { Browser, getInstalledBrowsers, install } from '@puppeteer/browsers'
import { SearchResponse, Urls } from './types'
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

export function getUrl(type: keyof typeof Urls, id?: string): string {
  const url = Urls.API + Urls[type]
  return id ? url.replace('{id}', id) : url
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
