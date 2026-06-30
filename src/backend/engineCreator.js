import { FiltersEngine } from '@ghostery/adblocker'

import {
  FILTER_LIST_CACHE_NAME,
  FILTER_LIST_CACHE_TTL_MS,
  getEnabledFilterLists,
} from './lists/catalog.ts'

const SOURCE_STATE = new Map()
const BRAVE_RESOURCES_SOURCE = {
  title: 'Brave adblock resources',
  url: 'https://raw.githubusercontent.com/brave/adblock-resources/master/dist/resources.json',
  listId: 'adblockResources',
  listName: 'Brave adblock resources',
  shard: 'resources',
  required: false,
  format: 'JSON',
}
const FALLBACK_RESOURCES_JSON = JSON.stringify([
  {
    name: 'noop.js',
    aliases: ['noopjs', 'noop'],
    kind: { mime: 'application/javascript' },
    content: 'Ow==',
  },
  {
    name: 'noop.txt',
    aliases: ['nooptext'],
    kind: { mime: 'text/plain' },
    content: '',
  },
  {
    name: '1x1-transparent.gif',
    aliases: ['1x1.gif', 'transparent.gif'],
    kind: { mime: 'image/gif' },
    content: 'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
  },
])

const supportsCacheApi = () => typeof caches !== 'undefined'

const getFetchedAt = (response) => {
  const value = response.headers.get('x-midori-fetched-at')
  return value ? Number(value) : 0
}

const isFresh = (response, now) => {
  const fetchedAt = getFetchedAt(response)
  return fetchedAt > 0 && now - fetchedAt < FILTER_LIST_CACHE_TTL_MS
}

const rememberSourceState = (source, state) => {
  SOURCE_STATE.set(source.url, {
    title: source.title,
    url: source.url,
    listId: source.listId,
    listName: source.listName,
    shard: source.shard,
    required: source.required,
    format: source.format,
    source: state.source,
    updatedAt: state.updatedAt,
    ageMs: state.updatedAt ? Date.now() - state.updatedAt : undefined,
    error: state.error,
  })
}

const createCachedFetch = (sources, forceRefresh) => {
  const sourceByUrl = new Map(sources.map((source) => [source.url, source]))

  return async (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    const source = sourceByUrl.get(url) || { title: url, url }
    const now = Date.now()
    const cache = supportsCacheApi()
      ? await caches.open(FILTER_LIST_CACHE_NAME)
      : undefined
    const cachedResponse = cache ? await cache.match(url) : undefined

    if (cachedResponse && !forceRefresh && isFresh(cachedResponse, now)) {
      rememberSourceState(source, {
        source: 'cache',
        updatedAt: getFetchedAt(cachedResponse),
      })
      return cachedResponse.clone()
    }

    try {
      const response = await fetch(input, { ...init, cache: 'no-cache' })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const text = await response.text()
      const cachedCopy = new Response(text, {
        status: 200,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'x-midori-fetched-at': String(now),
          'x-midori-source-url': url,
        },
      })

      if (cache) {
        await cache.put(url, cachedCopy.clone())
      }

      rememberSourceState(source, { source: 'network', updatedAt: now })
      return cachedCopy
    } catch (error) {
      if (cachedResponse) {
        rememberSourceState(source, {
          source: 'stale-cache',
          updatedAt: getFetchedAt(cachedResponse),
          error: error instanceof Error ? error.message : String(error),
        })
        return cachedResponse.clone()
      }

      rememberSourceState(source, {
        source: 'error',
        updatedAt: 0,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }
}

async function createEngine(source, forceRefresh) {
  const listSources = source.sources.map((listSource) => ({
    ...listSource,
    listId: source.id,
    listName: source.name,
    shard: source.shard,
    required: source.required,
  }))
  const listFetch = createCachedFetch(listSources, forceRefresh)

  return {
    name: source.name,
    sources: listSources,
    engine: await FiltersEngine.fromLists(
      listFetch,
      listSources.map((listSource) => listSource.url)
    ),
  }
}

async function readRulesText(sources, forceRefresh) {
  const listFetch = createCachedFetch(sources, forceRefresh)
  const chunks = await Promise.all(
    sources.map(async (source) => {
      const response = await listFetch(source.url)
      const text = await response.text()
      return `! ${source.title}\n${text}`
    })
  )

  return chunks.join('\n')
}

async function readResourcesJson(forceRefresh) {
  const listFetch = createCachedFetch([BRAVE_RESOURCES_SOURCE], forceRefresh)
  const response = await listFetch(BRAVE_RESOURCES_SOURCE.url)
  return await response.text()
}

onmessage = async (event) => {
  const payload = event.data
  const settings = payload.settings || payload
  const forceRefresh = Boolean(payload.forceRefresh)
  SOURCE_STATE.clear()

  try {
    const sources = getEnabledFilterLists(settings)

    const engines = await Promise.all(
      sources.map(async (source) => {
        try {
          return await createEngine(source, forceRefresh)
        } catch (error) {
          if (source.required) {
            throw error
          }

          // eslint-disable-next-line no-console
          console.warn(`Skipping optional block list "${source.name}"`, error)
          return null
        }
      })
    )

    const activeEngines = engines.filter(Boolean)
    const rustSources = activeEngines.flatMap((engine) => engine.sources)
    const [rustRules, rustResourcesJson] = await Promise.all([
      readRulesText(rustSources, forceRefresh),
      readResourcesJson(forceRefresh).catch((error) => {
        rememberSourceState(BRAVE_RESOURCES_SOURCE, {
          source: 'error',
          updatedAt: 0,
          error: error instanceof Error ? error.message : String(error),
        })
        return FALLBACK_RESOURCES_JSON
      }),
    ])

    // Serialize the engine and send it back.
    postMessage({
      engines: activeEngines.map((engine) => ({
        name: engine.name,
        engine: engine.engine.serialize(),
      })),
      rustRules,
      rustResourcesJson,
      listStates: Array.from(SOURCE_STATE.values()),
      updatedAt: Date.now(),
    })
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to create the core block list engine', error)
    postMessage({
      engines: [],
      rustRules: '',
      rustResourcesJson: FALLBACK_RESOURCES_JSON,
      listStates: Array.from(SOURCE_STATE.values()),
      updatedAt: Date.now(),
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
