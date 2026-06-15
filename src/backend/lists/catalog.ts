import { SettingsStorage } from '../../constants/settings'

export type FilterListSource = {
  title: string
  url: string
  format: 'Standard' | 'Hosts'
  supportUrl: string
}

export type FilterListCatalogEntry = {
  id: keyof SettingsStorage['lists']
  name: string
  description: string
  required: boolean
  defaultEnabled: boolean
  source: 'brave' | 'midori' | 'community'
  sources: FilterListSource[]
}

export const FILTER_LIST_CACHE_TTL_MS = 12 * 60 * 60 * 1000

export const FILTER_LIST_CACHE_NAME = 'midori-privacy-filter-lists-v1'

export const FILTER_LIST_CATALOG: FilterListCatalogEntry[] = [
  {
    id: 'common',
    name: 'Midori default ads and privacy',
    description:
      'EasyList, EasyPrivacy, uBlock Origin and Brave default rules.',
    required: true,
    defaultEnabled: true,
    source: 'brave',
    sources: [
      {
        title: 'uBlock Origin filters',
        url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt',
        format: 'Standard',
        supportUrl: 'https://github.com/uBlockOrigin/uAssets',
      },
      {
        title: 'uBlock Origin 2020 filters',
        url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters-2020.txt',
        format: 'Standard',
        supportUrl: 'https://github.com/uBlockOrigin/uAssets',
      },
      {
        title: 'uBlock Origin 2021 filters',
        url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters-2021.txt',
        format: 'Standard',
        supportUrl: 'https://github.com/uBlockOrigin/uAssets',
      },
      {
        title: 'uBlock Origin 2022 filters',
        url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters-2022.txt',
        format: 'Standard',
        supportUrl: 'https://github.com/uBlockOrigin/uAssets',
      },
      {
        title: 'uBlock Origin 2023 filters',
        url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters-2023.txt',
        format: 'Standard',
        supportUrl: 'https://github.com/uBlockOrigin/uAssets',
      },
      {
        title: 'uBlock Origin 2024 filters',
        url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters-2024.txt',
        format: 'Standard',
        supportUrl: 'https://github.com/uBlockOrigin/uAssets',
      },
      {
        title: 'uBlock Origin 2025 filters',
        url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters-2025.txt',
        format: 'Standard',
        supportUrl: 'https://github.com/uBlockOrigin/uAssets',
      },
      {
        title: 'uBlock Origin 2026 filters',
        url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters-2026.txt',
        format: 'Standard',
        supportUrl: 'https://github.com/uBlockOrigin/uAssets',
      },
      {
        title: 'uBlock Origin general filters',
        url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters-general.txt',
        format: 'Standard',
        supportUrl: 'https://github.com/uBlockOrigin/uAssets',
      },
      {
        title: 'uBlock Origin privacy filters',
        url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/privacy.txt',
        format: 'Standard',
        supportUrl: 'https://github.com/uBlockOrigin/uAssets',
      },
      {
        title: 'uBlock Origin badware risks',
        url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/badware.txt',
        format: 'Standard',
        supportUrl: 'https://github.com/uBlockOrigin/uAssets',
      },
      {
        title: 'uBlock Origin unbreak filters',
        url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/unbreak.txt',
        format: 'Standard',
        supportUrl: 'https://github.com/uBlockOrigin/uAssets',
      },
      {
        title: 'uBlock Origin quick fixes',
        url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/quick-fixes.txt',
        format: 'Standard',
        supportUrl: 'https://github.com/uBlockOrigin/uAssets',
      },
      {
        title: 'uBlock Origin link shorteners',
        url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/ubo-link-shorteners.txt',
        format: 'Standard',
        supportUrl: 'https://github.com/uBlockOrigin/uAssets',
      },
      {
        title: 'EasyList',
        url: 'https://easylist.to/easylist/easylist.txt',
        format: 'Standard',
        supportUrl: 'https://easylist.to/',
      },
      {
        title: 'EasyPrivacy',
        url: 'https://easylist.to/easylist/easyprivacy.txt',
        format: 'Standard',
        supportUrl: 'https://easylist.to/',
      },
      {
        title: 'Brave specific rules',
        url: 'https://raw.githubusercontent.com/brave/adblock-lists/master/brave-lists/brave-specific.txt',
        format: 'Standard',
        supportUrl: 'https://github.com/brave/adblock-lists',
      },
      {
        title: 'Brave unbreak rules',
        url: 'https://raw.githubusercontent.com/brave/adblock-lists/master/brave-unbreak.txt',
        format: 'Standard',
        supportUrl: 'https://github.com/brave/adblock-lists',
      },
      {
        title: 'Brave list unbreak rules',
        url: 'https://raw.githubusercontent.com/brave/adblock-lists/master/brave-lists/brave-unbreak.txt',
        format: 'Standard',
        supportUrl: 'https://github.com/brave/adblock-lists',
      },
      {
        title: 'Brave SugarCoat rules',
        url: 'https://raw.githubusercontent.com/brave/adblock-lists/master/brave-lists/brave-sugarcoat.txt',
        format: 'Standard',
        supportUrl: 'https://github.com/brave-experiments/sugarcoat-pipeline',
      },
      {
        title: 'Brave Twitch ads',
        url: 'https://raw.githubusercontent.com/brave/adblock-lists/master/brave-lists/brave-twitch.txt',
        format: 'Standard',
        supportUrl: 'https://github.com/brave/adblock-lists',
      },
      {
        title: 'Brave page visibility and video rules',
        url: 'https://raw.githubusercontent.com/brave/adblock-lists/master/brave-lists/brave-pageview.txt',
        format: 'Standard',
        supportUrl: 'https://github.com/brave/adblock-lists',
      },
    ],
  },
  {
    id: 'youtubeDistractions',
    name: 'Brave YouTube distractions',
    description: 'Optional Brave rules for YouTube prompts and distractions.',
    required: false,
    defaultEnabled: false,
    source: 'brave',
    sources: [
      {
        title: 'Brave YouTube distractions',
        url: 'https://raw.githubusercontent.com/brave/adblock-lists/master/brave-lists/yt-distracting.txt',
        format: 'Standard',
        supportUrl: 'https://github.com/brave/adblock-lists',
      },
    ],
  },
  {
    id: 'youtubeRecommended',
    name: 'Brave YouTube recommendations',
    description:
      'Optional Brave rules that reduce recommended YouTube surfaces.',
    required: false,
    defaultEnabled: false,
    source: 'brave',
    sources: [
      {
        title: 'Brave YouTube recommendations',
        url: 'https://raw.githubusercontent.com/brave/adblock-lists/master/brave-lists/yt-recommended.txt',
        format: 'Standard',
        supportUrl: 'https://github.com/brave/adblock-lists',
      },
    ],
  },
  {
    id: 'youtubeShorts',
    name: 'Brave YouTube Shorts',
    description: 'Optional Brave rules that hide YouTube Shorts surfaces.',
    required: false,
    defaultEnabled: false,
    source: 'brave',
    sources: [
      {
        title: 'Brave YouTube Shorts',
        url: 'https://raw.githubusercontent.com/brave/adblock-lists/master/brave-lists/yt-shorts.txt',
        format: 'Standard',
        supportUrl: 'https://github.com/brave/adblock-lists',
      },
    ],
  },
  {
    id: 'annoyances',
    name: 'Brave annoyances',
    description: 'Cookie notices, newsletter popups and other distractions.',
    required: false,
    defaultEnabled: false,
    source: 'brave',
    sources: [
      {
        title: 'Fanboy Annoyances',
        url: 'https://secure.fanboy.co.nz/fanboy-annoyance_ubo.txt',
        format: 'Standard',
        supportUrl: 'https://forums.lanik.us/',
      },
      {
        title: 'uBlock Origin cookie notices',
        url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/annoyances-cookies.txt',
        format: 'Standard',
        supportUrl: 'https://github.com/uBlockOrigin/uAssets',
      },
      {
        title: 'uBlock Origin annoyances',
        url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/annoyances-others.txt',
        format: 'Standard',
        supportUrl: 'https://github.com/uBlockOrigin/uAssets',
      },
      {
        title: 'Brave cookie-specific additions',
        url: 'https://raw.githubusercontent.com/brave/adblock-lists/master/brave-lists/brave-cookie-specific.txt',
        format: 'Standard',
        supportUrl: 'https://github.com/brave/adblock-lists',
      },
    ],
  },
  {
    id: 'social',
    name: 'Social media blocker',
    description: 'Fanboy and Brave social widgets, buttons and embeds rules.',
    required: false,
    defaultEnabled: false,
    source: 'brave',
    sources: [
      {
        title: 'Fanboy Social',
        url: 'https://easylist-downloads.adblockplus.org/fanboy-social.txt',
        format: 'Standard',
        supportUrl: 'https://forums.lanik.us/',
      },
      {
        title: 'Brave Social',
        url: 'https://raw.githubusercontent.com/brave/adblock-lists/master/brave-lists/brave-social.txt',
        format: 'Standard',
        supportUrl: 'https://github.com/brave/adblock-lists',
      },
    ],
  },
  {
    id: 'cleanWeb',
    name: 'Clean web',
    description: 'Malware, resource-abuse and URL tracking protection lists.',
    required: false,
    defaultEnabled: false,
    source: 'brave',
    sources: [
      {
        title: 'uBlock Origin resource abuse',
        url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/resource-abuse.txt',
        format: 'Standard',
        supportUrl: 'https://github.com/uBlockOrigin/uAssets',
      },
      {
        title: 'URLhaus malicious URL blocklist',
        url: 'https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-agh-online.txt',
        format: 'Standard',
        supportUrl: 'https://gitlab.com/malware-filter/urlhaus-filter',
      },
      {
        title: 'AdGuard URL tracking protection',
        url: 'https://raw.githubusercontent.com/AdguardTeam/FiltersRegistry/master/filters/filter_17_TrackParam/filter.txt',
        format: 'Standard',
        supportUrl:
          'https://github.com/AdguardTeam/AdguardFilters#adguard-filters',
      },
    ],
  },
  {
    id: 'ipGrabbers',
    name: 'IP grabbers',
    description:
      'Midori legacy IP grabber protection until a Brave catalog equivalent is selected.',
    required: false,
    defaultEnabled: false,
    source: 'midori',
    sources: [
      {
        title: 'Dot Shield IP grabbers',
        url: 'https://raw.githubusercontent.com/dothq-extensions/shield-db/main/out/ip_grabbers.txt',
        format: 'Standard',
        supportUrl: 'https://github.com/dothq-extensions/shield-db',
      },
    ],
  },
  {
    id: 'fakeNews',
    name: 'Fake news',
    description: 'Midori legacy fake news protection list.',
    required: false,
    defaultEnabled: false,
    source: 'midori',
    sources: [
      {
        title: 'Dot Shield fake news',
        url: 'https://raw.githubusercontent.com/dothq-extensions/shield-db/main/out/fake_news.txt',
        format: 'Standard',
        supportUrl: 'https://github.com/dothq-extensions/shield-db',
      },
    ],
  },
  {
    id: 'gambling',
    name: 'Gambling',
    description: 'Midori legacy gambling protection list.',
    required: false,
    defaultEnabled: false,
    source: 'midori',
    sources: [
      {
        title: 'Dot Shield gambling',
        url: 'https://raw.githubusercontent.com/dothq-extensions/shield-db/main/out/gambling.txt',
        format: 'Standard',
        supportUrl: 'https://github.com/dothq-extensions/shield-db',
      },
    ],
  },
]

export function getEnabledFilterLists(
  settings: SettingsStorage
): FilterListCatalogEntry[] {
  return FILTER_LIST_CATALOG.filter((entry) => {
    if (entry.required) return true
    return Boolean(settings.lists[entry.id])
  })
}

export function getFilterListLabels(
  lists: SettingsStorage['lists']
): Record<string, boolean> {
  return FILTER_LIST_CATALOG.reduce<Record<string, boolean>>(
    (labels, entry) => {
      labels[entry.name] = entry.required || Boolean(lists[entry.id])
      return labels
    },
    {}
  )
}
