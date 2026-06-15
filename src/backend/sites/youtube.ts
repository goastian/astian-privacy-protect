// Note that google really doesn't want ads blocked on youtube, hence why
// the default adblock behavior doesn't work properly. Instead we need to create
// a custom blocker that stops ads from being displayed. A really simple bodge
// is to just click the skip button instantly and seem like we have properly skipped
// the ad. The skip button ad is currently .ytp-ad-text.ytp-ad-skip-button-text

import { println } from '../lib/logger'
import { remoteFn } from '../lib/remoteFunctions'
import { getYoutubeAdStyles, hideYoutubeAdContainers } from './youtubeAds'

const CONTENT_BLOCK_MESSAGE = 'midori.contentBlock'

let pendingReportedBlocks = 0
let reportTimer: number | undefined

const reportContentBlocks = (count: number) => {
  if (count <= 0) return

  pendingReportedBlocks += count

  if (typeof reportTimer !== 'undefined') return

  reportTimer = window.setTimeout(() => {
    const blocked = pendingReportedBlocks
    pendingReportedBlocks = 0
    reportTimer = undefined

    browser.runtime
      .sendMessage({
        type: CONTENT_BLOCK_MESSAGE,
        url: window.location.href,
        reason: 'youtube-cosmetic',
        count: blocked,
      })
      .catch(() => undefined)
  }, 250)
}

const installYoutubeStyles = () => {
  const style = document.createElement('style')
  style.setAttribute('data-midori-youtube-adblock', 'true')
  style.append(document.createTextNode(getYoutubeAdStyles()))
  ;(document.head || document.documentElement).append(style)
}

const pruneYoutubeAds = (root: ParentNode = document) => {
  reportContentBlocks(hideYoutubeAdContainers(root))
}

const installYoutubeObserver = () => {
  const observer = new MutationObserver((records) => {
    let shouldScanDocument = false

    records.forEach((record) => {
      record.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return

        const tagName = node.tagName.toLowerCase()
        if (tagName.startsWith('ytd-') || tagName.startsWith('ytm-')) {
          pruneYoutubeAds(node)
          return
        }

        if (node.querySelector('ytd-ad-slot-renderer, ytd-ad-badge-renderer')) {
          pruneYoutubeAds(node)
          return
        }

        shouldScanDocument = true
      })
    })

    if (shouldScanDocument) pruneYoutubeAds(document)
  })

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  })
}

// Needs to be in an async block to get the whitelist
;(async () => {
  const whitelist = await remoteFn('getWhitelist')
    .then((value) => value as string[])
    .catch(() => [])

  if (whitelist.includes('youtube.com')) return

  installYoutubeStyles()
  pruneYoutubeAds(document)
  installYoutubeObserver()

  setInterval(() => {
    // Grab the skip button
    const skipButton: HTMLElement = document.querySelector(
      '.ytp-ad-text.ytp-ad-skip-button-text, .ytp-skip-ad-button, .ytp-ad-skip-button-modern'
    )

    // If the skip button does exists
    if (skipButton) {
      // Lets "smash that skip button"
      skipButton.click()
      // Provide feedback in the console
      println('Video was skipped')
      reportContentBlocks(1)
    }
  }, 100)

  println(
    '================================\nMidori Privacy Adblock is enabled on youtube.com\nWe will try to block all ads on this webpage'
  )
})()
