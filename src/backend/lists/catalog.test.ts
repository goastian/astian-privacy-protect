import { DEFAULT_SETTINGS, SettingsStorage } from '../../constants/settings'
import { FILTER_LIST_CATALOG, getEnabledFilterLists } from './catalog'

const createSettings = (
  lists: Partial<SettingsStorage['lists']> = {}
): SettingsStorage => ({
  ...DEFAULT_SETTINGS,
  lists: {
    ...DEFAULT_SETTINGS.lists,
    ...lists,
  },
})

describe('filter list catalog', () => {
  it('keeps the required Brave default list enabled', () => {
    const enabledLists = getEnabledFilterLists(
      createSettings({ common: false })
    )

    expect(enabledLists.map((list) => list.id)).toContain('common')
  })

  it('keeps the required default list aligned with Brave-style default sources', () => {
    const common = FILTER_LIST_CATALOG.find((list) => list.id === 'common')

    expect(common?.sources.map((source) => source.title)).toEqual(
      expect.arrayContaining([
        'EasyList',
        'EasyPrivacy',
        'uBlock Origin quick fixes',
        'Brave specific rules',
        'Brave SugarCoat rules',
        'Brave Twitch ads',
        'Brave page visibility and video rules',
      ])
    )
  })

  it('maps every settings list key to a catalog entry', () => {
    const catalogIds = new Set(FILTER_LIST_CATALOG.map((list) => list.id))

    Object.keys(DEFAULT_SETTINGS.lists).forEach((listId) => {
      expect(catalogIds.has(listId as keyof SettingsStorage['lists'])).toBe(
        true
      )
    })
  })

  it('enables optional lists only when their toggle is enabled', () => {
    const enabledLists = getEnabledFilterLists(
      createSettings({ annoyances: true, social: true, youtubeShorts: true })
    )

    expect(enabledLists.map((list) => list.id)).toEqual([
      'common',
      'youtubeShorts',
      'annoyances',
      'social',
    ])
  })

  it('keeps optional YouTube Brave lists out of the default common rules', () => {
    const common = FILTER_LIST_CATALOG.find((list) => list.id === 'common')
    const optionalYoutubeLists = FILTER_LIST_CATALOG.filter((list) =>
      ['youtubeDistractions', 'youtubeRecommended', 'youtubeShorts'].includes(
        list.id
      )
    )

    expect(common?.sources.map((source) => source.title)).not.toEqual(
      expect.arrayContaining([
        'Brave YouTube distractions',
        'Brave YouTube recommendations',
        'Brave YouTube Shorts',
      ])
    )
    expect(optionalYoutubeLists).toHaveLength(3)
  })

  it('uses raw downloadable GitHub URLs for filter sources', () => {
    FILTER_LIST_CATALOG.flatMap((list) => list.sources).forEach((source) => {
      expect(source.url).not.toContain('/blob/')
      expect(source.url).not.toMatch(/^https:\/\/github\.com\/.*\.txt$/)
    })
  })
})
