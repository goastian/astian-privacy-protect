const fs = require('node:fs/promises')
const path = require('node:path')
const { FiltersEngine, Request } = require('@ghostery/adblocker')

const catalogPath = path.join(__dirname, '../src/backend/lists/catalog.ts')
const resourcesUrl =
  'https://raw.githubusercontent.com/brave/adblock-resources/master/dist/resources.json'
const sourcePattern = /url: '(https:[^']+)'/g
const concurrency = 6

const decisionSamples = [
  {
    expected: true,
    url: 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
    sourceUrl: 'https://www.youtube.com/watch?v=midori-test',
    type: 'script',
  },
  {
    expected: true,
    url: 'https://www.youtube.com/api/stats/ads?ver=2',
    sourceUrl: 'https://www.youtube.com/watch?v=midori-test',
    type: 'xmlhttprequest',
  },
  {
    expected: true,
    url: 'https://imasdk.googleapis.com/js/sdkloader/ima3.js',
    sourceUrl: 'https://www.youtube.com/watch?v=midori-test',
    type: 'script',
  },
  {
    expected: true,
    url: 'https://pubads.g.doubleclick.net/gampad/ads?iu=/test',
    sourceUrl: 'https://example.com/video',
    type: 'xmlhttprequest',
  },
  {
    expected: null,
    url: 'https://spclient.wg.spotify.com/ads/v1/ads/hmac',
    sourceUrl: 'https://open.spotify.com/',
    type: 'xmlhttprequest',
  },
  {
    expected: false,
    url: 'https://i.ytimg.com/vi/midori-test/hqdefault.jpg',
    sourceUrl: 'https://www.youtube.com/watch?v=midori-test',
    type: 'image',
  },
]

async function mapConcurrent(items, mapper) {
  const results = new Array(items.length)
  let cursor = 0

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++
        results[index] = await mapper(items[index])
      }
    })
  )

  return results
}

async function download(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const startedAt = Date.now()

    try {
      const response = await fetch(url, {
        cache: 'no-cache',
        signal: AbortSignal.timeout(20_000),
      })
      const text = await response.text()
      if (response.ok || attempt === 3) {
        return {
          url,
          ok: response.ok,
          status: response.status,
          bytes: Buffer.byteLength(text),
          elapsedMs: Date.now() - startedAt,
          attempt,
          text,
        }
      }
    } catch (error) {
      if (attempt === 3) {
        return {
          url,
          ok: false,
          status: 0,
          bytes: 0,
          elapsedMs: Date.now() - startedAt,
          attempt,
          error: error instanceof Error ? error.message : String(error),
          text: '',
        }
      }
    }
  }

  throw new Error(`Unreachable download state for ${url}`)
}

async function main() {
  const catalog = await fs.readFile(catalogPath, 'utf8')
  const filterUrls = Array.from(
    catalog.matchAll(sourcePattern),
    (match) => match[1]
  )
  const downloads = await mapConcurrent([...filterUrls, resourcesUrl], download)

  downloads.forEach(({ status, bytes, elapsedMs, attempt, url, error }) => {
    console.log(
      `${status || 'ERR'}\t${bytes}\t${elapsedMs}ms\ttry=${attempt}\t${url}${
        error ? `\t${error}` : ''
      }`
    )
  })

  const failed = downloads.filter((result) => !result.ok)
  const rules = downloads
    .filter((result) => result.ok && result.url !== resourcesUrl)
    .map((result) => result.text)
    .join('\n')
  const engine = FiltersEngine.parse(rules)
  let decisionFailures = 0

  decisionSamples.forEach((sample, index) => {
    const request = Request.fromRawDetails({
      requestId: String(index),
      tabId: 1,
      url: sample.url,
      sourceUrl: sample.sourceUrl,
      type: sample.type,
    })
    const blocked = engine.match(request).match
    const informational = sample.expected === null
    const passed = informational || blocked === sample.expected
    if (!passed) decisionFailures++
    console.log(
      `${informational ? 'INFO' : passed ? 'PASS' : 'FAIL'}\t${
        blocked ? 'BLOCK' : 'ALLOW'
      }\t${sample.url}`
    )
  })

  console.log(
    JSON.stringify({
      sources: downloads.length,
      healthy: downloads.length - failed.length,
      failed: failed.length,
      downloadedBytes: downloads.reduce(
        (total, result) => total + result.bytes,
        0
      ),
      decisionSamples: decisionSamples.length,
      decisionFailures,
    })
  )

  if (failed.length || decisionFailures) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
