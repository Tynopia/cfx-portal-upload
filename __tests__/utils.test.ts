/* eslint-disable @typescript-eslint/unbound-method */
import { jest, describe, it, expect, beforeEach, afterAll } from '@jest/globals'
import fs from 'fs'
import os from 'os'
import path from 'path'
import yazl from 'yazl'
import {
  coreMock,
  puppeteerBrowsersMock,
  registerAxiosMock,
  registerCoreMock,
  registerPuppeteerBrowsersMock,
  resetPackageMocks
} from './helpers/mocks.js'

registerAxiosMock()
registerCoreMock()
registerPuppeteerBrowsersMock()

const axios = (await import('axios')).default
const core = await import('@actions/core')
const { PUPPETEER_REVISIONS } = await import(
  'puppeteer-core/internal/revisions.js'
)
const { Urls } = await import('../src/types.js')
const {
  getUrl,
  getEnv,
  isBetaAsset,
  getFxManifestVersion,
  getCachedFileContent,
  clearFileCache,
  resolveAssetId,
  getCommitMessage,
  getChangelog,
  deleteIfExists,
  getAssetVersions,
  deleteAssetVersion,
  preparePuppeteer,
  zipAsset
} = await import('../src/utils.js')

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cfx-portal-upload-'))
}

const tempDirs: string[] = []
const tempFiles: string[] = []

async function createZip(entries: Record<string, string>): Promise<string> {
  const zipDir = makeTempDir()
  tempDirs.push(zipDir)
  const zipPath = path.join(zipDir, 'test.zip')
  const zipfile = new yazl.ZipFile()

  for (const [filePath, content] of Object.entries(entries)) {
    zipfile.addBuffer(Buffer.from(content), filePath)
  }

  zipfile.end()

  return new Promise((resolve, reject) => {
    zipfile.outputStream
      .pipe(fs.createWriteStream(zipPath))
      .on('close', () => resolve(zipPath))
      .on('error', reject)
  })
}

describe('utils', () => {
  const originalEnv = process.env

  beforeEach(() => {
    resetPackageMocks()
    process.env = { ...originalEnv }
    clearFileCache()
  })

  afterAll(() => {
    process.env = originalEnv

    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true })
    }

    for (const file of tempFiles) {
      fs.rmSync(file, { force: true })
    }
  })

  function createWorkspace(): string {
    const workspace = makeTempDir()
    tempDirs.push(workspace)
    process.env.GITHUB_WORKSPACE = workspace
    return workspace
  }

  describe('zipAsset', () => {
    it('should create a zip file successfully', async () => {
      const workspace = createWorkspace()
      fs.writeFileSync(path.join(workspace, 'file1.txt'), 'file1')
      fs.mkdirSync(path.join(workspace, 'subdir'))
      fs.writeFileSync(path.join(workspace, 'subdir', 'file2.txt'), 'file2')

      const zipPath = await zipAsset('my-asset')
      tempFiles.push(zipPath)

      expect(zipPath).toContain('my-asset.zip')
      expect(fs.existsSync(zipPath)).toBe(true)

      const content = await getCachedFileContent(
        'subdir/file2.txt',
        zipPath,
        true
      )
      expect(content).toBe('file2')
    })
  })

  describe('getCachedFileContent', () => {
    it('should return cached content if available', async () => {
      const workspace = createWorkspace()
      const filePath = path.join(workspace, 'file-cached.txt')
      fs.writeFileSync(filePath, 'content1')

      const content = await getCachedFileContent('file-cached.txt')
      expect(content).toBe('content1')

      fs.writeFileSync(filePath, 'content2')
      const contentCached = await getCachedFileContent('file-cached.txt')
      expect(contentCached).toBe('content1')
    })

    it('should read from zip if zipPath is provided and exists', async () => {
      const zipPath = await createZip({ 'file-in-zip.txt': 'zip-content' })

      const content = await getCachedFileContent('file-in-zip.txt', zipPath)
      expect(content).toBe('zip-content')
    })

    it('should find file one level deeper in zip if allowOneLevelDeeper is true', async () => {
      const zipPath = await createZip({
        'subdir/file-in-zip.txt': 'zip-content-deeper'
      })

      const content = await getCachedFileContent(
        'file-in-zip.txt',
        zipPath,
        true
      )
      expect(content).toBe('zip-content-deeper')
    })

    it('should find file one level deeper locally if allowOneLevelDeeper is true', async () => {
      const workspace = createWorkspace()
      fs.mkdirSync(path.join(workspace, 'subdir'))
      fs.writeFileSync(path.join(workspace, 'subdir', 'file.txt'), 'deeper')

      const content = await getCachedFileContent('file.txt', undefined, true)
      expect(content).toBe('deeper')
    })

    it('should throw error if file not found locally', async () => {
      createWorkspace()

      await expect(getCachedFileContent('missing.txt')).rejects.toThrow(
        'File missing.txt not found'
      )
    })
  })

  describe('preparePuppeteer', () => {
    it('should skip if RUNNER_TEMP is not set', async () => {
      delete process.env.RUNNER_TEMP

      await expect(preparePuppeteer()).resolves.toBeUndefined()
      expect(core.info as jest.Mock).toHaveBeenCalledWith(
        'Running locally, skipping Puppeteer setup ...'
      )
    })

    it('should install Chrome if not installed', async () => {
      process.env.RUNNER_TEMP = '/tmp'
      puppeteerBrowsersMock.getInstalledBrowsers.mockResolvedValue([])
      puppeteerBrowsersMock.install.mockResolvedValue({
        executablePath: '/chrome'
      })

      const executablePath = await preparePuppeteer()

      expect(puppeteerBrowsersMock.install).toHaveBeenCalledWith(
        expect.objectContaining({
          browser: puppeteerBrowsersMock.Browser.CHROME,
          buildId: PUPPETEER_REVISIONS.chrome
        })
      )
      expect(executablePath).toBe('/chrome')
    })

    it('should not install Chrome if the expected build is already installed', async () => {
      process.env.RUNNER_TEMP = '/tmp'
      puppeteerBrowsersMock.getInstalledBrowsers.mockResolvedValue([
        {
          browser: puppeteerBrowsersMock.Browser.CHROME,
          buildId: PUPPETEER_REVISIONS.chrome,
          executablePath: '/cached-chrome'
        }
      ])

      const executablePath = await preparePuppeteer()

      expect(puppeteerBrowsersMock.install).not.toHaveBeenCalled()
      expect(executablePath).toBe('/cached-chrome')
    })
  })

  describe('getAssetVersions', () => {
    it('should fetch versions successfully', async () => {
      const mockVersions = [{ id: 1, version: '1.0.0' }]
      ;(axios.get as jest.Mock).mockResolvedValue({
        data: { versions: mockVersions }
      })

      const versions = await getAssetVersions('123', 'cookie')

      expect(versions).toEqual(mockVersions)
      expect(axios.get as jest.Mock).toHaveBeenCalledWith(
        expect.stringContaining('/assets/123'),
        expect.objectContaining({
          headers: { Cookie: 'cookie' }
        })
      )
    })
  })

  describe('deleteAssetVersion', () => {
    it('should delete version successfully', async () => {
      await deleteAssetVersion('123', 456, 'cookie')

      expect(axios.delete as jest.Mock).toHaveBeenCalledWith(
        expect.stringContaining('/assets/123/versions/456'),
        expect.objectContaining({
          headers: { Cookie: 'cookie' }
        })
      )
    })
  })

  describe('getUrl', () => {
    it('should return API URL for SSO', () => {
      const url = getUrl('SSO')
      expect(url).toBe(Urls.API + Urls.SSO)
    })

    it('should replace parameters in URL', () => {
      const url = getUrl('REUPLOAD', { id: 123 })
      expect(url).toBe(Urls.API + Urls.REUPLOAD.replace('{id}', '123'))
    })
  })

  describe('getEnv', () => {
    it('should return environment variable value', () => {
      process.env.TEST_VAR = 'test-value'
      expect(getEnv('TEST_VAR')).toBe('test-value')
    })

    it('should throw error if environment variable is not set', () => {
      delete process.env.TEST_VAR
      expect(() => getEnv('TEST_VAR')).toThrow(
        'Environment variable TEST_VAR is not set.'
      )
    })
  })

  describe('isBetaAsset', () => {
    it('should return false if fxmanifest.lua not found', async () => {
      createWorkspace()

      await expect(isBetaAsset()).resolves.toBe(false)
    })

    it('should return true if beta tag is present', async () => {
      const workspace = createWorkspace()
      fs.writeFileSync(
        path.join(workspace, 'fxmanifest.lua'),
        "version '1.0.0'\nbeta 'true'"
      )

      await expect(isBetaAsset()).resolves.toBe(true)
    })

    it('should find fxmanifest.lua one level deeper locally', async () => {
      const workspace = createWorkspace()
      fs.mkdirSync(path.join(workspace, 'subdir'))
      fs.writeFileSync(
        path.join(workspace, 'subdir', 'fxmanifest.lua'),
        "beta 'true'"
      )

      await expect(isBetaAsset()).resolves.toBe(true)
    })

    it('should return false if beta tag is missing', async () => {
      const workspace = createWorkspace()
      fs.writeFileSync(
        path.join(workspace, 'fxmanifest.lua'),
        "version '1.0.0'"
      )

      await expect(isBetaAsset()).resolves.toBe(false)
    })

    it('should read from zip if zipPath is provided', async () => {
      const zipPath = await createZip({ 'fxmanifest.lua': "beta 'true'" })

      await expect(isBetaAsset(zipPath)).resolves.toBe(true)
    })

    it('should read from zip one level deeper', async () => {
      const zipPath = await createZip({
        'subdir/fxmanifest.lua': "beta 'true'"
      })

      await expect(isBetaAsset(zipPath)).resolves.toBe(true)
    })
  })

  describe('getFxManifestVersion', () => {
    it('should return version string', async () => {
      const workspace = createWorkspace()
      fs.writeFileSync(
        path.join(workspace, 'fxmanifest.lua'),
        "version '1.2.3'"
      )

      await expect(getFxManifestVersion()).resolves.toBe('1.2.3')
    })

    it('should find fxmanifest.lua one level deeper locally', async () => {
      const workspace = createWorkspace()
      fs.mkdirSync(path.join(workspace, 'subdir'))
      fs.writeFileSync(
        path.join(workspace, 'subdir', 'fxmanifest.lua'),
        "version '2.3.4'"
      )

      await expect(getFxManifestVersion()).resolves.toBe('2.3.4')
    })

    it('should throw error if version tag is missing', async () => {
      const workspace = createWorkspace()
      fs.writeFileSync(path.join(workspace, 'fxmanifest.lua'), '')

      await expect(getFxManifestVersion()).rejects.toThrow(
        "fxmanifest.lua does not have a `version '...'` tag."
      )
    })

    it('should read from zip if zipPath is provided', async () => {
      const zipPath = await createZip({ 'fxmanifest.lua': "version '2.0.0'" })

      await expect(getFxManifestVersion(zipPath)).resolves.toBe('2.0.0')
    })

    it('should read from zip one level deeper', async () => {
      const zipPath = await createZip({
        'subdir/fxmanifest.lua': "version '3.0.0'"
      })

      await expect(getFxManifestVersion(zipPath)).resolves.toBe('3.0.0')
    })
  })

  describe('resolveAssetId', () => {
    it('should return asset id if exact match found', async () => {
      ;(axios.get as jest.Mock).mockResolvedValue({
        data: {
          items: [
            { id: 1, name: 'other' },
            { id: 42, name: 'my-asset' }
          ]
        }
      })

      const id = await resolveAssetId('my-asset', 'cookie')
      expect(id).toBe('42')
    })

    it('should throw error if no items found', async () => {
      ;(axios.get as jest.Mock).mockResolvedValue({
        data: {
          items: []
        }
      })

      await expect(resolveAssetId('my-asset', 'cookie')).rejects.toThrow(
        'Failed to find asset id for "my-asset".'
      )
    })

    it('should throw error if no exact match found', async () => {
      ;(axios.get as jest.Mock).mockResolvedValue({
        data: {
          items: [{ id: 1, name: 'my-asset-suffix' }]
        }
      })

      await expect(resolveAssetId('my-asset', 'cookie')).rejects.toThrow(
        'Failed to find asset id for "my-asset" exact match.'
      )
    })
  })

  describe('getCommitMessage', () => {
    it('should return commit message from GITHUB_EVENT_PATH', () => {
      const workspace = createWorkspace()
      const eventPath = path.join(workspace, 'event.json')
      process.env.GITHUB_EVENT_PATH = eventPath
      fs.writeFileSync(
        eventPath,
        JSON.stringify({ head_commit: { message: 'feat: new feature' } })
      )

      expect(getCommitMessage()).toBe('feat: new feature')
    })

    it('should return default message if event file missing', () => {
      delete process.env.GITHUB_EVENT_PATH
      expect(getCommitMessage()).toBe('No changelog provided')
    })

    it('should return default message if JSON parsing fails', () => {
      const workspace = createWorkspace()
      const eventPath = path.join(workspace, 'event.json')
      process.env.GITHUB_EVENT_PATH = eventPath
      fs.writeFileSync(eventPath, 'invalid json')

      expect(getCommitMessage()).toBe('No changelog provided')
      expect(core.debug).toHaveBeenCalledWith(
        expect.stringContaining('Failed to get commit message')
      )
    })
  })

  describe('getChangelog', () => {
    it('should return input changelog if provided', async () => {
      ;(coreMock.getInput as jest.Mock).mockReturnValue('manual changelog')
      await expect(getChangelog()).resolves.toBe('manual changelog')
    })

    it('should return content from changelogFile if provided', async () => {
      const workspace = createWorkspace()
      fs.writeFileSync(path.join(workspace, 'CHANGELOG.md'), 'file content')
      ;(coreMock.getInput as jest.Mock).mockImplementation(name => {
        if (name === 'changelog') return ''
        if (name === 'changelogFile') return 'CHANGELOG.md'
        return ''
      })

      await expect(getChangelog()).resolves.toBe('file content')
    })

    it('should read changelog from zip if zipPath is provided', async () => {
      ;(coreMock.getInput as jest.Mock).mockImplementation(name => {
        if (name === 'changelog') return ''
        if (name === 'changelogFile') return 'CHANGELOG.md'
        return ''
      })

      const zipPath = await createZip({ 'CHANGELOG.md': 'zip-changelog' })

      await expect(getChangelog(zipPath)).resolves.toBe('zip-changelog')
    })
  })

  describe('deleteIfExists', () => {
    it('should delete directory if it exists', () => {
      const workspace = createWorkspace()
      const dirPath = path.join(workspace, 'test-dir')
      fs.mkdirSync(dirPath)

      deleteIfExists('test-dir')

      expect(fs.existsSync(dirPath)).toBe(false)
    })

    it('should delete file if it exists', () => {
      const workspace = createWorkspace()
      const filePath = path.join(workspace, 'test-file')
      fs.writeFileSync(filePath, 'content')

      deleteIfExists('test-file')

      expect(fs.existsSync(filePath)).toBe(false)
    })
  })
})
