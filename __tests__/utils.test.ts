/* eslint-disable @typescript-eslint/unbound-method */
import * as fs from 'fs'
import * as path from 'path'
import axios from 'axios'
import * as core from '@actions/core'
import yazl from 'yazl'
import { install, getInstalledBrowsers, Browser } from '@puppeteer/browsers'
import { Urls } from '../src/types'
import {
  getUrl,
  getEnv,
  validateFxManifest,
  isBetaAsset,
  getFxManifestVersion,
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

describe('utils', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.resetAllMocks()
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

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

  describe('validateFxManifest', () => {
    it('should throw error if fxmanifest.lua not found', () => {
      process.env.GITHUB_WORKSPACE = '/workspace'
      ;(fs.existsSync as jest.Mock).mockReturnValue(false)

      expect(() => validateFxManifest()).toThrow(
        'fxmanifest.lua not found in the workspace.'
      )
    })

    it('should throw error if version tag is missing', () => {
      process.env.GITHUB_WORKSPACE = '/workspace'
      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      ;(fs.readFileSync as jest.Mock).mockReturnValue('fx_version "cerulean"')

      expect(() => validateFxManifest()).toThrow(
        "fxmanifest.lua does not have a `version '%s'` tag."
      )
    })

    it('should not throw error if version tag is present', () => {
      process.env.GITHUB_WORKSPACE = '/workspace'
      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      ;(fs.readFileSync as jest.Mock).mockReturnValue(
        "fx_version 'cerulean'\nversion '1.0.0'"
      )

      expect(() => validateFxManifest()).not.toThrow()
    })
  })

  describe('isBetaAsset', () => {
    it('should return false if fxmanifest.lua not found', () => {
      process.env.GITHUB_WORKSPACE = '/workspace'
      ;(fs.existsSync as jest.Mock).mockReturnValue(false)

      expect(isBetaAsset()).toBe(false)
    })

    it('should return true if beta tag is present', () => {
      process.env.GITHUB_WORKSPACE = '/workspace'
      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      ;(fs.readFileSync as jest.Mock).mockReturnValue("beta 'true'")

      expect(isBetaAsset()).toBe(true)
    })

    it('should return false if beta tag is missing', () => {
      process.env.GITHUB_WORKSPACE = '/workspace'
      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      ;(fs.readFileSync as jest.Mock).mockReturnValue("version '1.0.0'")

      expect(isBetaAsset()).toBe(false)
    })
  })

  describe('getFxManifestVersion', () => {
    it('should return version string', () => {
      process.env.GITHUB_WORKSPACE = '/workspace'
      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      ;(fs.readFileSync as jest.Mock).mockReturnValue("version '1.2.3'")

      expect(getFxManifestVersion()).toBe('1.2.3')
    })

    it('should throw error if version tag is missing', () => {
      process.env.GITHUB_WORKSPACE = '/workspace'
      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      ;(fs.readFileSync as jest.Mock).mockReturnValue('')

      expect(() => getFxManifestVersion()).toThrow(
        "fxmanifest.lua does not have a `version '%s'` tag."
      )
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
    it('should return input changelog if provided', () => {
      ;(core.getInput as jest.Mock).mockReturnValue('manual changelog')
      expect(getChangelog()).toBe('manual changelog')
    })

    it('should return content from changelogFile if provided', () => {
      ;(core.getInput as jest.Mock).mockImplementation(name => {
        if (name === 'changelog') return ''
        if (name === 'changelogFile') return 'CHANGELOG.md'
        return ''
      })
      process.env.GITHUB_WORKSPACE = '/workspace'
      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      ;(fs.readFileSync as jest.Mock).mockReturnValue('file content')

      expect(getChangelog()).toBe('file content')
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
