import { parse } from 'psl'

import { remoteFn } from '../../../backend/lib/remoteFunctions'

const getHostname = (url: string) =>
  url.replace('https://', '').replace('http://', '').split('/')[0]

const getDomain = (url: string) => {
  const hostname = getHostname(url)
  const parsed = parse(hostname)
  return 'domain' in parsed ? parsed.domain || hostname : hostname
}

const params = new URLSearchParams(window.location.search)

if (params.has('list')) {
  const blocklist = params.get('list')

  const by = document.getElementById('by')
  if (by) {
    by.innerText = `This page was blocked by the ${blocklist} list`
  }
}

const whitelistA = document.getElementById('whitelist')

if (whitelistA) {
  whitelistA.onclick = () => {
    const url = params.get('url') || ''
    remoteFn('addToWhitelist', getDomain(url)).then(() =>
      setTimeout(() => (window.location.href = url), 100)
    )
  }
}
