import React, { Component } from 'react'
import { parse } from 'psl'

import { remoteFn } from '../../../backend/lib/remoteFunctions'
import { App } from './app'
import { BackendState } from '../../../constants/state'
import defaultFavicon from '../assets/defaultFavicon.svg'

const getDomain = (url = '') =>
  (() => {
    const hostname = url
      .replace('https://', '')
      .replace('http://', '')
      .split('/')[0]
    if (!hostname) return ''
    const parsed = parse(hostname)
    return 'domain' in parsed ? parsed.domain || hostname : hostname
  })()

const DEFAULT_COLOR = '#222222'

const safeRemoteFn = async <Payload,>(
  name: string,
  fallback: Payload
): Promise<Payload> => {
  try {
    return (await remoteFn(name)) as Payload
  } catch {
    return fallback
  }
}

export type ProtectionSummary = {
  state: BackendState
  engineLoadMs: number
  engineCount: number
  engineNames: string[]
  enabled: boolean
  lists: Record<string, boolean>
  filterListStates: {
    title: string
    url: string
    source: 'network' | 'cache' | 'stale-cache' | 'error'
    updatedAt: number
    ageMs?: number
    error?: string
  }[]
  filterListsUpdatedAt: number
  rustEngineRuleCount: number
  rustEngineResourceCount: number
  rustEngineLoadError: string
  globalCosmeticRuleCount: number
  core: string
}

export type AppState = {
  blocked: number
  whitelisted: boolean
  favicon: string
  color: string
  activeDomain: string
  backgroundState: BackendState
  totalBlocked: number
  blockedDomains: { url: string; num: number }[]
  protectionSummary?: ProtectionSummary
  hasPermissions: boolean
}

export class State extends Component {
  private refreshTimer?: number

  state: AppState = {
    blocked: 0,
    totalBlocked: 0,
    whitelisted: false,
    favicon: defaultFavicon,
    color: 'rgba(0,0,0,0)', // This creates a fade in with the color
    activeDomain: '',
    backgroundState: BackendState.Idle,
    blockedDomains: [],
    hasPermissions: true,
  }

  componentDidMount(): void {
    this.refreshState()
    this.refreshTimer = window.setInterval(() => this.refreshState(), 1000)

    browser.tabs
      .query({
        active: true,
        currentWindow: true,
      })
      .then(async (tab) => {
        const activeTab = tab[0]
        const activeDomain = getDomain(activeTab?.url)
        const favicon =
          activeTab?.favIconUrl && !activeTab.favIconUrl.includes('chrome://')
            ? activeTab.favIconUrl
            : defaultFavicon

        this.setState({
          ...this.state,
          activeDomain,
          favicon,
          color: DEFAULT_COLOR,
        })
      })
      .catch(() => {
        this.setState({ ...this.state, hasPermissions: false })
      })

    safeRemoteFn<string[]>('getWhitelist', []).then(
      this.updateWhitelist.bind(this)
    )
  }

  componentWillUnmount(): void {
    if (typeof this.refreshTimer !== 'undefined') {
      window.clearInterval(this.refreshTimer)
    }
  }

  async refreshState(): Promise<void> {
    safeRemoteFn('getState', BackendState.Idle).then((state) =>
      this.setState({ ...this.state, backgroundState: state })
    )

    safeRemoteFn('getAllTrackersBlocked', 0).then((count) =>
      this.setState({ ...this.state, totalBlocked: count })
    )

    safeRemoteFn<ProtectionSummary | undefined>(
      'getProtectionSummary',
      undefined
    ).then((summary) => {
      if (!summary) return

      this.setState({
        ...this.state,
        protectionSummary: summary,
        backgroundState: summary.state,
      })
    })

    safeRemoteFn<Record<number, string[]>>('getAds', {}).then(
      async (blocked) => {
        // Get current tab
        const tab = await browser.tabs.query({
          active: true,
          currentWindow: true,
        })
        const tabId = tab[0]?.id

        if (typeof tabId === 'undefined') return

        // If this tab has had any ads blocked on it
        if (
          typeof blocked[tabId] !== 'undefined' &&
          blocked[tabId].length !== 0
        ) {
          // Something has been blocked. Do something with the data
          const blockedURLs = blocked[tabId]

          const blockedDomains = blockedURLs
            .map((url: string) => ({
              num: 1,
              url: getDomain(url),
            }))
            .filter(
              (
                curr: { url: string; num: number },
                i: number,
                arr: { url: string; num: number }[]
              ) => {
                const match = arr.findIndex(
                  (t: { url: string }) => t.url === curr.url
                )
                const notDuplicate = match === i

                if (!notDuplicate) {
                  arr[match].num = arr[match].num + 1
                }

                return notDuplicate
              }
            )

          let singleItem = 0
          blockedDomains.forEach(
            (element: { num: number }) => (singleItem += element.num)
          )
          const blockedNum = singleItem

          this.setState({
            blockedDomains,
            blocked: blockedNum,
          })
        } else {
          this.setState({ blockedDomains: [], blocked: 0 })
        }
      }
    )
  }

  async updateWhitelist(whitelist: string[]): Promise<void> {
    // Get current tab
    const tab = await browser.tabs.query({
      active: true,
      currentWindow: true,
    })

    const tabURL = getDomain(tab[0]?.url)

    if (whitelist.indexOf(tabURL) !== -1) {
      this.setState({ ...this.state, whitelisted: true })
    } else {
      this.setState({ ...this.state, whitelisted: false })
    }
  }

  async toggleWhitelist(): Promise<void> {
    // Common function
    const tab = await browser.tabs.query({
      active: true,
      currentWindow: true,
    })
    const tabURL = getDomain(tab[0]?.url)

    if (!tabURL) return

    if (this.state.whitelisted) {
      // Remove from whitelist
      remoteFn('removeFromWhitelist', tabURL).then(
        this.updateWhitelist.bind(this)
      )
    } else {
      // Add to whitelist
      remoteFn('addToWhitelist', tabURL).then(this.updateWhitelist.bind(this))
    }
  }

  render(): JSX.Element {
    return (
      <App
        state={this.state}
        toggleWhitelist={this.toggleWhitelist.bind(this)}
      />
    )
  }
}
