/* eslint-disable @typescript-eslint/unbound-method */
import * as fs from 'fs'
import * as path from 'path'
import axios from 'axios'
import * as core from '@actions/core'
import yazl from 'yazl'
import yauzl from 'yauzl'
import { install, getInstalledBrowsers, Browser } from '@puppeteer/browsers'
import { Urls } from '../src/types'
import {
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
} from '../src/utils'

jest.mock('fs', () => {
  const actualFs = jest.requireActual<typeof import('fs')>('fs')

  return {
    ...actualFs,
    existsSync: jest.fn(),
    readFileSync: jest.fn(),
    lstatSync: jest.fn(),
    rmSync: jest.fn(),
    unlinkSync: jest.fn(),
    statSync: jest.fn(),
    readdirSync: jest.fn(),
    createWriteStream: jest.fn().mockReturnValue({
      on: jest
        .fn()
        .mockImplementation((event: string, cb: () => void): object => {
          if (event === 'close') cb()
          return { on: jest.fn() }
        })
    }),
    promises: {
      ...actualFs.promises,
      access: jest.fn()
    }
  }
})
jest.mock('axios')
jest.mock('@actions/core')
jest.mock('@puppeteer/browsers')
jest.mock('yazl')
jest.mock('yauzl')

describe('utils', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.resetAllMocks()
    process.env = { ...originalEnv }
    clearFileCache()
  })

  afterAll(() => {
    process.env = originalEnv
  })

  const setupZipMock = (fileName: string, content: string): void => {
    const mockStream = {
      on: jest
        .fn()
        .mockImplementation((event: string, cb: (data?: string) => void) => {
          if (event === 'data') cb(content)
          if (event === 'end') cb()
          return mockStream
        })
    }
    const mockZipFile = {
      readEntry: jest.fn(),
      on: jest
        .fn()
        .mockImplementation(
          (event: string, cb: (entry?: { fileName: string }) => void) => {
            if (event === 'entry') cb({ fileName })
            return mockZipFile
          }
        ),
      openReadStream: jest
        .fn()
        .mockImplementation(
          (
            entry: { fileName: string },
            cb: (err: Error | null, stream: typeof mockStream) => void
          ) => {
            cb(null, mockStream)
          }
        )
    }
    ;(yauzl.open as unknown as jest.Mock).mockImplementation(
      (
        _path: string,
        _options: object,
        cb: (err: Error | null, zip: typeof mockZipFile) => void
      ) => {
        cb(null, mockZipFile)
      }
    )
    ;(fs.existsSync as jest.Mock).mockReturnValue(true)
  }

  describe('zipAsset', () => {
    it('should create a zip file successfully', async () => {
      process.env.GITHUB_WORKSPACE = '/workspace'
      const mockZipFile = {
        addFile: jest.fn(),
        end: jest.fn(),
        outputStream: {
          pipe: jest.fn().mockReturnValue({
            on: jest
              .fn()
              .mockImplementation((event: string, cb: () => void): object => {
                if (event === 'close') cb()
                return { on: jest.fn().mockReturnValue({ on: jest.fn() }) }
              })
          })
        }
      }
      ;(yazl.ZipFile as unknown as jest.Mock).mockReturnValue(mockZipFile)
      ;(fs.readdirSync as jest.Mock).mockImplementation(
        (p: string, options?: { withFileTypes?: boolean }) => {
          if (p === '/workspace') {
            if (options?.withFileTypes) {
              return [
                {
                  name: 'file1.txt',
                  isDirectory: () => false,
                  isFile: () => true
                },
                { name: 'subdir', isDirectory: () => true, isFile: () => false }
              ]
            }
            return ['file1.txt', 'subdir']
          }
          if (p === path.join('/workspace', 'subdir')) {
            if (options?.withFileTypes) {
              return [
                {
                  name: 'file2.txt',
                  isDirectory: () => false,
                  isFile: () => true
                }
              ]
            }
            return ['file2.txt']
          }
          return []
        }
      )
      ;(fs.statSync as jest.Mock).mockImplementation(p => {
        if (p === '/workspace' || p === path.join('/workspace', 'subdir')) {
          return { isDirectory: () => true, isFile: () => false }
        }
        return { isDirectory: () => false, isFile: () => true }
      })

      const zipPath = await zipAsset('my-asset')

      expect(zipPath).toContain('my-asset.zip')
      expect(mockZipFile.addFile).toHaveBeenCalledTimes(2)
      expect(mockZipFile.end).toHaveBeenCalled()
    })
  })

  describe('getCachedFileContent', () => {
    it('should return cached content if available', async () => {
      process.env.GITHUB_WORKSPACE = '/workspace'
      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      ;(fs.readFileSync as jest.Mock).mockReturnValue('content1')

      // Use a unique filename to avoid cache collision with other tests if needed
      const content = await getCachedFileContent('file-cached.txt')
      expect(content).toBe('content1')

      // Second call should use cache (even if we change readFileSync return)
      ;(fs.readFileSync as jest.Mock).mockReturnValue('content2')
      const contentCached = await getCachedFileContent('file-cached.txt')
      expect(contentCached).toBe('content1')
    })

    it('should read from zip if zipPath is provided and exists', async () => {
      setupZipMock('file-in-zip.txt', 'zip-content')

      const content = await getCachedFileContent('file-in-zip.txt', 'test.zip')
      expect(content).toBe('zip-content')
      expect(yauzl.open).toHaveBeenCalledWith(
        'test.zip',
        { lazyEntries: true },
        expect.any(Function)
      )
    })

    it('should find file one level deeper in zip if allowOneLevelDeeper is true', async () => {
      setupZipMock('subdir/file-in-zip.txt', 'zip-content-deeper')

      const content = await getCachedFileContent(
        'file-in-zip.txt',
        'test.zip',
        true
      )
      expect(content).toBe('zip-content-deeper')
    })

    it('should find file one level deeper locally if allowOneLevelDeeper is true', async () => {
      const workspacePath = path.resolve('/workspace')
      process.env.GITHUB_WORKSPACE = workspacePath
      const filePath = 'file.txt'
      const fullPath = path.join(workspacePath, filePath)
      const deeperPath = path.join(workspacePath, 'subdir', filePath)

      ;(fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        if (p === fullPath) return false
        if (p === deeperPath) return true
        return false
      })
      ;(fs.readdirSync as jest.Mock).mockImplementation((p: string) => {
        if (path.resolve(p) === workspacePath) {
          return [
            {
              name: 'subdir',
              isDirectory: () => true
            }
          ]
        }
        return []
      })
      ;(fs.readFileSync as jest.Mock).mockReturnValue('deeper-content')

      const content = await getCachedFileContent(filePath, undefined, true)
      expect(content).toBe('deeper-content')
      expect(fs.readFileSync).toHaveBeenCalledWith(deeperPath, 'utf8')
    })

    it('should throw error if file not found locally', async () => {
      process.env.GITHUB_WORKSPACE = '/workspace'
      ;(fs.existsSync as jest.Mock).mockReturnValue(false)

      await expect(getCachedFileContent('missing.txt')).rejects.toThrow(
        'File missing.txt not found'
      )
    })
  })

  describe('preparePuppeteer', () => {
    it('should skip if RUNNER_TEMP is not set', async () => {
      delete process.env.RUNNER_TEMP
      await preparePuppeteer()
      expect(core.info as jest.Mock).toHaveBeenCalledWith(
        'Running locally, skipping Puppeteer setup ...'
      )
    })

    it('should install Chrome if not installed', async () => {
      process.env.RUNNER_TEMP = '/tmp'
      ;(getInstalledBrowsers as jest.Mock).mockResolvedValue([])
      ;(install as jest.Mock).mockResolvedValue({})

      await preparePuppeteer()

      expect(install).toHaveBeenCalledWith(
        expect.objectContaining({
          browser: Browser.CHROME
        })
      )
    })

    it('should not install Chrome if already installed', async () => {
      process.env.RUNNER_TEMP = '/tmp'
      ;(getInstalledBrowsers as jest.Mock).mockResolvedValue([
        { browser: Browser.CHROME }
      ])

      await preparePuppeteer()

      expect(install).not.toHaveBeenCalled()
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
      process.env.GITHUB_WORKSPACE = '/workspace'
      ;(fs.existsSync as jest.Mock).mockReturnValue(false)

      await expect(isBetaAsset()).resolves.toBe(false)
    })

    it('should return true if beta tag is present', async () => {
      process.env.GITHUB_WORKSPACE = '/workspace'
      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      ;(fs.readFileSync as jest.Mock).mockReturnValue(
        "version '1.0.0'\nbeta 'true'"
      )

      await expect(isBetaAsset()).resolves.toBe(true)
    })

    it('should find fxmanifest.lua one level deeper locally', async () => {
      const workspacePath = path.resolve('/workspace')
      process.env.GITHUB_WORKSPACE = workspacePath
      const deeperPath = path.join(workspacePath, 'subdir', 'fxmanifest.lua')

      ;(fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        if (p === path.join(workspacePath, 'fxmanifest.lua')) return false
        if (p === deeperPath) return true
        return false
      })
      ;(fs.readdirSync as jest.Mock).mockImplementation((p: string) => {
        if (path.resolve(p) === workspacePath) {
          return [{ name: 'subdir', isDirectory: () => true }]
        }
        return []
      })
      ;(fs.readFileSync as jest.Mock).mockReturnValue("beta 'true'")

      await expect(isBetaAsset()).resolves.toBe(true)
      expect(fs.readFileSync).toHaveBeenCalledWith(deeperPath, 'utf8')
    })

    it('should return false if beta tag is missing', async () => {
      process.env.GITHUB_WORKSPACE = '/workspace'
      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      ;(fs.readFileSync as jest.Mock).mockReturnValue("version '1.0.0'")

      await expect(isBetaAsset()).resolves.toBe(false)
    })

    it('should read from zip if zipPath is provided', async () => {
      setupZipMock('fxmanifest.lua', "beta 'true'")

      await expect(isBetaAsset('test.zip')).resolves.toBe(true)
      expect(yauzl.open).toHaveBeenCalledWith(
        'test.zip',
        { lazyEntries: true },
        expect.any(Function)
      )
    })

    it('should read from zip one level deeper', async () => {
      setupZipMock('subdir/fxmanifest.lua', "beta 'true'")

      await expect(isBetaAsset('test.zip')).resolves.toBe(true)
    })
  })

  describe('getFxManifestVersion', () => {
    it('should return version string', async () => {
      process.env.GITHUB_WORKSPACE = '/workspace'
      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      ;(fs.readFileSync as jest.Mock).mockReturnValue("version '1.2.3'")

      await expect(getFxManifestVersion()).resolves.toBe('1.2.3')
    })

    it('should find fxmanifest.lua one level deeper locally', async () => {
      const workspacePath = path.resolve('/workspace')
      process.env.GITHUB_WORKSPACE = workspacePath
      const deeperPath = path.join(workspacePath, 'subdir', 'fxmanifest.lua')

      ;(fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        if (p === path.join(workspacePath, 'fxmanifest.lua')) return false
        if (p === deeperPath) return true
        return false
      })
      ;(fs.readdirSync as jest.Mock).mockImplementation((p: string) => {
        if (path.resolve(p) === workspacePath) {
          return [{ name: 'subdir', isDirectory: () => true }]
        }
        return []
      })
      ;(fs.readFileSync as jest.Mock).mockReturnValue("version '2.3.4'")

      await expect(getFxManifestVersion()).resolves.toBe('2.3.4')
      expect(fs.readFileSync).toHaveBeenCalledWith(deeperPath, 'utf8')
    })

    it('should throw error if version tag is missing', async () => {
      process.env.GITHUB_WORKSPACE = '/workspace'
      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      ;(fs.readFileSync as jest.Mock).mockReturnValue('')

      await expect(getFxManifestVersion()).rejects.toThrow(
        "fxmanifest.lua does not have a `version '...'` tag."
      )
    })

    it('should read from zip if zipPath is provided', async () => {
      setupZipMock('fxmanifest.lua', "version '2.0.0'")

      await expect(getFxManifestVersion('test.zip')).resolves.toBe('2.0.0')
    })

    it('should read from zip one level deeper', async () => {
      setupZipMock('subdir/fxmanifest.lua', "version '3.0.0'")

      await expect(getFxManifestVersion('test.zip')).resolves.toBe('3.0.0')
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
      process.env.GITHUB_EVENT_PATH = '/event.json'
      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      ;(fs.readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({ head_commit: { message: 'feat: new feature' } })
      )

      expect(getCommitMessage()).toBe('feat: new feature')
    })

    it('should return default message if event file missing', () => {
      delete process.env.GITHUB_EVENT_PATH
      expect(getCommitMessage()).toBe('No changelog provided')
    })

    it('should return default message if JSON parsing fails', () => {
      process.env.GITHUB_EVENT_PATH = '/event.json'
      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      ;(fs.readFileSync as jest.Mock).mockReturnValue('invalid json')

      expect(getCommitMessage()).toBe('No changelog provided')
      expect(core.debug).toHaveBeenCalledWith(
        expect.stringContaining('Failed to get commit message')
      )
    })
  })

  describe('getChangelog', () => {
    it('should return input changelog if provided', async () => {
      ;(core.getInput as jest.Mock).mockReturnValue('manual changelog')
      await expect(getChangelog()).resolves.toBe('manual changelog')
    })

    it('should return content from changelogFile if provided', async () => {
      ;(core.getInput as jest.Mock).mockImplementation(name => {
        if (name === 'changelog') return ''
        if (name === 'changelogFile') return 'CHANGELOG.md'
        return ''
      })
      process.env.GITHUB_WORKSPACE = '/workspace'
      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      ;(fs.readFileSync as jest.Mock).mockReturnValue('file content')

      await expect(getChangelog()).resolves.toBe('file content')
    })

    it('should read changelog from zip if zipPath is provided', async () => {
      ;(core.getInput as jest.Mock).mockImplementation(name => {
        if (name === 'changelog') return ''
        if (name === 'changelogFile') return 'CHANGELOG.md'
        return ''
      })

      setupZipMock('CHANGELOG.md', 'zip-changelog')

      await expect(getChangelog('test.zip')).resolves.toBe('zip-changelog')
    })
  })

  describe('deleteIfExists', () => {
    it('should delete directory if it exists', () => {
      process.env.GITHUB_WORKSPACE = '/workspace'
      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      ;(fs.lstatSync as jest.Mock).mockReturnValue({
        isDirectory: () => true,
        isFile: () => false
      })

      deleteIfExists('test-dir')

      expect(fs.rmSync).toHaveBeenCalledWith(
        path.join('/workspace', 'test-dir'),
        { recursive: true, force: true }
      )
    })

    it('should delete file if it exists', () => {
      process.env.GITHUB_WORKSPACE = '/workspace'
      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      ;(fs.lstatSync as jest.Mock).mockReturnValue({
        isDirectory: () => false,
        isFile: () => true
      })

      deleteIfExists('test-file')

      expect(fs.unlinkSync).toHaveBeenCalledWith(
        path.join('/workspace', 'test-file')
      )
    })
  })
})
