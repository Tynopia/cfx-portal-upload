import * as core from '@actions/core'
import puppeteer, { Browser, Page } from 'puppeteer'
import FormData from 'form-data'
import axios from 'axios'

import { createReadStream, statSync } from 'fs'
import { basename } from 'path'
import { ReUploadResponse, SSOResponseBody } from './types'
import {
  deleteIfExists,
  resolveAssetId,
  getEnv,
  getUrl,
  preparePuppeteer,
  zipAsset
} from './utils'

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  await preparePuppeteer()

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  })

  const page = await browser.newPage()

  try {
    let assetId = core.getInput('assetId')
    let assetName = core.getInput('assetName')

    let zipPath = core.getInput('zipPath')
    const makeZip = core.getInput('makeZip').toLowerCase() === 'true'
    const skipUpload = core.getInput('skipUpload').toLowerCase() === 'true'

    const chunkSize = parseInt(core.getInput('chunkSize'))
    const maxRetries = parseInt(core.getInput('maxRetries'))

    if (isNaN(chunkSize)) {
      throw new Error('Invalid chunk size. Must be a number.')
    }

    if (isNaN(maxRetries)) {
      throw new Error('Invalid max retries. Must be a number.')
    }

    // No asset id or name provided, using the repository name
    // If skipUpload is true, we don't need to update the asset name
    if (!assetId && !assetName && !skipUpload) {
      core.debug('No asset id or name provided, using repository name...')
      assetName = basename(getEnv('GITHUB_WORKSPACE'))
    }

    const redirectUrl = await getRedirectUrl(page, maxRetries)
    await setForumCookie(browser, page)

    await page.goto(redirectUrl, {
      waitUntil: 'networkidle0'
    })

    if (page.url().includes('portal.cfx.re')) {
      if (skipUpload) {
        core.info('Redirected to CFX Portal. Skipping upload ...')
      } else {
        core.info('Redirected to CFX Portal. Uploading file ...')
        const cookies = await getCookies(browser)

        if (assetName) {
          assetId = await resolveAssetId(assetName, cookies)
        }

        zipPath = await getZipPath(assetName, zipPath, makeZip)
        await uploadZip(zipPath, assetId, chunkSize, cookies)
      }
    } else {
      throw new Error(
        'Redirect failed. Make sure the provided Cookie is valid.'
      )
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    }
  } finally {
    await browser.close()
  }
}

/**
 * Navigates to the SSO URL and waits for the page to load.
 * If the navigation fails, it will retry up to `maxRetries` times.
 * @param page
 * @param maxRetries
 * @returns {Promise<string>} The redirect URL.
 * @throws If the navigation fails after `maxRetries` attempts.
 */
async function getRedirectUrl(page: Page, maxRetries: number): Promise<string> {
  let loaded = false
  let attempt = 0
  let redirectUrl = null

  while (!loaded && attempt < maxRetries) {
    try {
      core.info('Navigating to SSO URL ...')

      await page.goto(getUrl('SSO'), {
        waitUntil: 'networkidle0'
      })

      core.info('Navigated to SSO URL. Parsing response body ...')

      const responseBody = await page.evaluate(
        () => JSON.parse(document.body.innerText) as SSOResponseBody
      )

      core.debug('Parsed response body.')

      redirectUrl = responseBody.url

      core.info('Redirected to Forum Origin ...')

      const forumUrl = new URL(redirectUrl).origin
      await page.goto(forumUrl)

      loaded = true
    } catch {
      core.info(`Failed to navigate to SSO URL. Retrying in 1 seconds...`)
      await new Promise(resolve => setTimeout(resolve, 1000))
      attempt++
    }
  }

  if (!loaded || redirectUrl == null) {
    throw new Error(
      `Failed to navigate to SSO URL after ${maxRetries} attempts.`
    )
  }

  return redirectUrl
}

/**
 * Sets the cookie for the cfx.re login.
 * @param browser
 * @param page
 * @returns {Promise<void>} Resolves when the cookie has been set.
 */
async function setForumCookie(browser: Browser, page: Page): Promise<void> {
  core.info('Setting cookies ...')

  await browser.setCookie({
    name: '_t',
    value: core.getInput('cookie'),
    domain: 'forum.cfx.re',
    path: '/',
    expires: -1,
    size: 1,
    httpOnly: true,
    secure: true,
    session: false
  })

  await page.evaluate(() => document.write('Cookie' + document.cookie))

  core.info('Cookies set. Following redirect...')
}

/**
 * Gets the cookies from the browser.
 * @param browser
 * @returns {Promise<string>} Resolves with the cookies as a string.
 */
async function getCookies(browser: Browser): Promise<string> {
  return await browser
    .cookies()
    .then(cookies =>
      cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
    )
}

/**
 * Retrieves the zipPath or creates a zip based on the provided parameters.
 * @param assetName - The name of the asset.
 * @param zipPath - The path to the zip file.
 * @param makeZip - Flag indicating whether to create a zip file.
 * @returns {Promise<string>} Resolves with the path to the zip file.
 * @throws If neither zipPath nor makeZip is provided, or if the pre-zip command fails.
 */
async function getZipPath(
  assetName: string,
  zipPath: string,
  makeZip: boolean
): Promise<string> {
  core.debug('Zip path: ' + JSON.stringify(zipPath))
  if (zipPath.length > 0) {
    core.debug('Using provided zip path.')
    return zipPath
  }

  if (!makeZip && zipPath.length == 0) {
    throw new Error(
      'Either zipPath or makeZip must be provided to upload a file.'
    )
  }

  core.info('Creating zip file ...')

  // Clean up github things before zipping
  deleteIfExists('.git/')
  deleteIfExists('.github/')
  deleteIfExists('.vscode/')

  return zipAsset(assetName)
}

/**
 * Starts the re-upload process by uploading the asset in chunks.
 * @param zipPath
 * @param assetId
 * @param chunkSize
 * @param cookies
 * @returns {Promise<void>} Resolves when the re-upload process is initiated successfully.
 * @throws If the re-upload fails due to errors in the response.
 */
async function startReupload(
  zipPath: string,
  assetId: string,
  chunkSize: number,
  cookies: string
): Promise<void> {
  const stats = statSync(zipPath)
  const totalSize = stats.size
  const originalFileName = basename(zipPath)
  const chunkCount = Math.ceil(totalSize / chunkSize)

  core.info('Starting upload ...')

  core.debug(`Total size: ${totalSize}`)
  core.debug(`Original file name: ${originalFileName}`)
  core.debug(`Chunk size: ${chunkSize}`)
  core.debug(`Chunk count: ${chunkCount}`)

  const reUploadReponse = await axios.post<ReUploadResponse>(
    getUrl('REUPLOAD', assetId),
    {
      chunk_count: chunkCount,
      chunk_size: chunkSize,
      name: originalFileName,
      original_file_name: originalFileName,
      total_size: totalSize
    },
    {
      headers: {
        Cookie: cookies
      }
    }
  )

  if (reUploadReponse.data.errors !== null) {
    core.debug(JSON.stringify(reUploadReponse.data.errors))
    throw new Error(
      'Failed to re-upload file. See debug logs for more information.'
    )
  }
}

/**
 * Uploads a zip file in chunks to the specified asset.
 * @param zipPath
 * @param assetId
 * @param chunkSize.
 * @param cookies
 * @returns {Promise<void>} Resolves when the upload is complete.
 * @throws If the upload fails at any stage.
 */
async function uploadZip(
  zipPath: string,
  assetId: string,
  chunkSize: number,
  cookies: string
): Promise<void> {
  await startReupload(zipPath, assetId, chunkSize, cookies)

  let chunkIndex = 0

  const stats = statSync(zipPath)
  const totalSize = stats.size
  const chunkCount = Math.ceil(totalSize / chunkSize)

  const stream = createReadStream(zipPath, { highWaterMark: chunkSize })

  for await (const chunk of stream) {
    const form = new FormData()
    form.append('chunk_id', chunkIndex)
    form.append('chunk', chunk, {
      filename: 'blob',
      contentType: 'application/octet-stream'
    })

    await axios.post(getUrl('UPLOAD_CHUNK', assetId), form, {
      headers: {
        ...form.getHeaders(),
        Cookie: cookies
      }
    })

    core.info(`Uploaded chunk ${chunkIndex + 1}/${chunkCount}`)

    chunkIndex++
  }

  await completeUpload(assetId, cookies)
}

/**
 * Completes the upload process.
 * @param assetId
 * @param cookies
 * @returns {Promise<void>} Resolves when the upload is complete.
 */
async function completeUpload(assetId: string, cookies: string): Promise<void> {
  await axios.post(
    getUrl('COMPLETE_UPLOAD', assetId),
    {},
    {
      headers: {
        Cookie: cookies
      }
    }
  )

  core.info('Upload completed.')
}
