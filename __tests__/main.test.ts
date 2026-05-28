/* eslint-disable @typescript-eslint/unbound-method */
import * as core from '@actions/core'
import * as main from '../src/main'
import puppeteer from 'puppeteer'
import * as utils from '../src/utils'
import axios from 'axios'
import * as fs from 'fs'

jest.mock('@actions/core')
jest.mock('puppeteer')
jest.mock('../src/utils')
jest.mock('axios')
jest.mock('fs', () => {
  const actualFs = jest.requireActual('fs') as unknown as typeof import('fs')
  return {
    ...actualFs,
    statSync: jest.fn(actualFs.statSync),
    createReadStream: jest.fn(actualFs.createReadStream)
  }
})

describe('main', () => {
  let getInputMock: jest.Mock
  let setFailedMock: jest.Mock
  let infoMock: jest.Mock

  let browserMock: {
    newPage: jest.Mock
    close: jest.Mock
    setCookie: jest.Mock
    cookies: jest.Mock
  }
  let pageMock: {
    goto: jest.Mock
    evaluate: jest.Mock
    url: jest.Mock
    close: jest.Mock
  }

  beforeEach(() => {
    jest.clearAllMocks()

    getInputMock = core.getInput as jest.Mock
    setFailedMock = core.setFailed as jest.Mock
    infoMock = core.info as jest.Mock

    pageMock = {
      goto: jest.fn(),
      evaluate: jest.fn(),
      url: jest.fn().mockReturnValue('https://portal.cfx.re'),
      close: jest.fn()
    }

    browserMock = {
      newPage: jest.fn().mockResolvedValue(pageMock),
      close: jest.fn(),
      setCookie: jest.fn(),
      cookies: jest
        .fn()
        .mockResolvedValue([{ name: '_t', value: 'test-cookie' }])
    }
    ;(puppeteer.launch as jest.Mock).mockResolvedValue(browserMock)

    // Default inputs
    getInputMock.mockImplementation((name: string) => {
      switch (name) {
        case 'chunkSize':
          return '1024'
        case 'maxRetries':
          return '3'
        case 'makeZip':
          return 'false'
        case 'skipUpload':
          return 'false'
        case 'deleteOlderVersions':
          return 'false'
        case 'beta':
          return 'false'
        default:
          return ''
      }
    })
    ;(utils.getUrl as jest.Mock).mockImplementation((type: string) => {
      if (type === 'SSO') return 'https://sso-url'
      return `https://api/${type}`
    })
  })

  it('should fail if chunkSize is not a number', async () => {
    getInputMock.mockImplementation((name: string) => {
      if (name === 'chunkSize') return 'invalid'
      return ''
    })

    await main.run()

    expect(setFailedMock).toHaveBeenCalledWith(
      'Invalid chunk size. Must be a number.'
    )
  })

  it('should fail if maxRetries is not a number', async () => {
    getInputMock.mockImplementation((name: string) => {
      if (name === 'maxRetries') return 'invalid'
      if (name === 'chunkSize') return '1024'
      return ''
    })

    await main.run()

    expect(setFailedMock).toHaveBeenCalledWith(
      'Invalid max retries. Must be a number.'
    )
  })

  it('should set beta to true if beta input is true', async () => {
    getInputMock.mockImplementation((name: string) => {
      switch (name) {
        case 'assetId':
          return '123'
        case 'zipPath':
          return 'test.zip'
        case 'beta':
          return 'true'
        case 'chunkSize':
          return '1024'
        case 'maxRetries':
          return '1'
        default:
          return ''
      }
    })

    pageMock.evaluate.mockResolvedValueOnce({ url: 'https://forum-redirect' })
    pageMock.url.mockReturnValue('https://portal.cfx.re')
    ;(utils.getFxManifestVersion as jest.Mock).mockReturnValue('1.0.0')
    ;(axios.post as jest.Mock).mockResolvedValue({
      data: { asset_id: 123, version_id: 456, errors: null }
    })

    await main.run()

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(axios.post as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining('REUPLOAD'),
      expect.objectContaining({ release_candidate: true }),
      expect.anything()
    )
  })

  it('should successfully complete the upload flow', async () => {
    getInputMock.mockImplementation((name: string) => {
      switch (name) {
        case 'assetId':
          return '123'
        case 'zipPath':
          return 'test.zip'
        case 'cookie':
          return 'test-cookie'
        case 'chunkSize':
          return '1024'
        case 'maxRetries':
          return '1'
        default:
          return 'false'
      }
    })

    pageMock.evaluate.mockResolvedValueOnce({ url: 'https://forum-redirect' })
    pageMock.url.mockReturnValue('https://portal.cfx.re')
    ;(utils.getFxManifestVersion as jest.Mock).mockReturnValue('1.0.0')
    ;(utils.getChangelog as jest.Mock).mockReturnValue('test changelog')

    // Mock axios for startReupload, uploadZip (internal chunks), and completeUpload
    ;(axios.post as jest.Mock).mockResolvedValue({
      data: {
        asset_id: 123,
        version_id: 456,
        errors: null
      }
    })

    // Mock fs for uploadZip
    ;(fs.statSync as jest.Mock).mockReturnValue({ size: 2048 })
    ;(fs.createReadStream as jest.Mock).mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        await Promise.resolve()
        yield Buffer.from('chunk1')
        yield Buffer.from('chunk2')
      }
    })

    await main.run()

    expect(utils.preparePuppeteer).toHaveBeenCalled()
    expect(puppeteer.launch as jest.Mock).toHaveBeenCalled()
    expect(pageMock.goto).toHaveBeenCalledWith(
      'https://sso-url',
      expect.anything()
    )
    expect(infoMock).toHaveBeenCalledWith(
      'Redirected to CFX Portal. Uploading file ...'
    )
    expect(browserMock.close).toHaveBeenCalled()
  })

  it('should resolve assetId from assetName if assetId is not provided', async () => {
    getInputMock.mockImplementation((name: string) => {
      switch (name) {
        case 'assetName':
          return 'my-asset'
        case 'zipPath':
          return 'test.zip'
        case 'cookie':
          return 'test-cookie'
        case 'chunkSize':
          return '1024'
        case 'maxRetries':
          return '1'
        default:
          return ''
      }
    })

    pageMock.evaluate.mockResolvedValueOnce({ url: 'https://forum-redirect' })
    pageMock.url.mockReturnValue('https://portal.cfx.re')
    ;(utils.resolveAssetId as jest.Mock).mockResolvedValue('789')
    ;(utils.getFxManifestVersion as jest.Mock).mockReturnValue('1.0.0')
    ;(utils.getChangelog as jest.Mock).mockReturnValue('test changelog')
    ;(axios.post as jest.Mock).mockResolvedValue({
      data: {
        asset_id: 789,
        version_id: 101,
        errors: null
      }
    })

    await main.run()

    expect(utils.resolveAssetId as jest.Mock).toHaveBeenCalledWith(
      'my-asset',
      expect.anything()
    )
    expect(infoMock).toHaveBeenCalledWith(
      'Redirected to CFX Portal. Uploading file ...'
    )
  })

  it('should use provided zipPath and not call zipAsset', async () => {
    getInputMock.mockImplementation((name: string) => {
      switch (name) {
        case 'assetId':
          return '123'
        case 'zipPath':
          return 'provided.zip'
        case 'chunkSize':
          return '1024'
        case 'maxRetries':
          return '1'
        default:
          return ''
      }
    })

    pageMock.evaluate.mockResolvedValueOnce({ url: 'https://forum-redirect' })
    pageMock.url.mockReturnValue('https://portal.cfx.re')
    ;(utils.getFxManifestVersion as jest.Mock).mockReturnValue('1.0.0')
    ;(axios.post as jest.Mock).mockResolvedValue({
      data: { asset_id: 123, version_id: 456, errors: null }
    })

    await main.run()

    expect(utils.zipAsset).not.toHaveBeenCalled()
    expect(infoMock).toHaveBeenCalledWith(
      'Redirected to CFX Portal. Uploading file ...'
    )
  })

  it('should delete older versions if deleteOlderVersions is true', async () => {
    getInputMock.mockImplementation((name: string) => {
      switch (name) {
        case 'assetId':
          return '123'
        case 'zipPath':
          return 'test.zip'
        case 'cookie':
          return 'test-cookie'
        case 'chunkSize':
          return '1024'
        case 'maxRetries':
          return '1'
        case 'deleteOlderVersions':
          return 'true'
        case 'makeZip':
        case 'skipUpload':
        case 'beta':
          return 'false'
        default:
          return ''
      }
    })

    pageMock.evaluate.mockResolvedValueOnce({ url: 'https://forum-redirect' })
    pageMock.url.mockReturnValue('https://portal.cfx.re')
    ;(utils.getFxManifestVersion as jest.Mock).mockReturnValue('1.0.0')
    ;(utils.getChangelog as jest.Mock).mockReturnValue('test changelog')
    ;(axios.post as jest.Mock).mockResolvedValue({
      data: {
        asset_id: 123,
        version_id: 456,
        errors: null
      }
    })
    ;(utils.getAssetVersions as jest.Mock).mockResolvedValue([
      { id: 456, version: '1.0.0' },
      { id: 111, version: '0.9.0' }
    ])

    await main.run()

    expect(infoMock).toHaveBeenCalledWith('Deleting older versions ...')
    expect(utils.deleteAssetVersion).toHaveBeenCalledWith(
      '123',
      111,
      expect.anything()
    )
    expect(utils.deleteAssetVersion).not.toHaveBeenCalledWith(
      '123',
      456,
      expect.anything()
    )
  })

  it('should skip upload if skipUpload is true', async () => {
    getInputMock.mockImplementation((name: string) => {
      if (name === 'skipUpload') return 'true'
      if (name === 'chunkSize') return '1024'
      if (name === 'maxRetries') return '1'
      return ''
    })

    pageMock.evaluate.mockResolvedValueOnce({ url: 'https://forum-redirect' })
    pageMock.url.mockReturnValue('https://portal.cfx.re')

    await main.run()

    expect(infoMock).toHaveBeenCalledWith(
      'Redirected to CFX Portal. Skipping upload ...'
    )
    expect(axios.post).not.toHaveBeenCalled()
  })

  it('should handle axios errors gracefully', async () => {
    getInputMock.mockImplementation((name: string) => {
      if (name === 'chunkSize') return '1024'
      if (name === 'maxRetries') return '1'
      if (name === 'assetId') return '123'
      if (name === 'zipPath') return 'test.zip'
      return ''
    })

    pageMock.evaluate.mockResolvedValueOnce({ url: 'https://forum-redirect' })
    pageMock.url.mockReturnValue('https://portal.cfx.re')

    const mockError = new Error('API Error')
    const axiosError = mockError as unknown as {
      response: { status: number; data: { message: string } }
    }
    axiosError.response = {
      status: 500,
      data: { message: 'Internal Server Error' }
    }
    ;(axios.isAxiosError as unknown as jest.Mock).mockReturnValue(true)
    ;(axios.post as jest.Mock).mockRejectedValueOnce(axiosError)
    ;(utils.getFxManifestVersion as jest.Mock).mockReturnValue('1.0.0')

    await main.run()

    expect(core.error).toHaveBeenCalledWith(
      expect.stringContaining('API Request failed [500]')
    )
  })
})
