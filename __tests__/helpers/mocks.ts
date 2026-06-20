import { jest } from '@jest/globals'

export const coreMock = {
  getInput: jest.fn(),
  setFailed: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warning: jest.fn()
}

export const axiosMock = {
  post: jest.fn(),
  get: jest.fn(),
  delete: jest.fn(),
  isAxiosError: jest.fn()
}

export const puppeteerBrowsersMock = {
  Browser: { CHROME: 'chrome' },
  getInstalledBrowsers: jest.fn(),
  install: jest.fn()
}

export function registerCoreMock(): void {
  jest.unstable_mockModule('@actions/core', () => coreMock)
}

export function registerAxiosMock(): void {
  jest.unstable_mockModule('axios', () => ({
    default: axiosMock,
    ...axiosMock
  }))
}

export function registerPuppeteerBrowsersMock(): void {
  jest.unstable_mockModule('@puppeteer/browsers', () => puppeteerBrowsersMock)
}

export function resetPackageMocks(): void {
  Object.values(coreMock).forEach(mock => mock.mockReset())
  Object.values(axiosMock).forEach(mock => mock.mockReset())
  puppeteerBrowsersMock.getInstalledBrowsers.mockReset()
  puppeteerBrowsersMock.install.mockReset()
}
