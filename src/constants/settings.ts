export type SettingsStorage = {
  version: 1.5
  enabled: boolean
  lists: {
    common: boolean
    social: boolean
    ipGrabbers: boolean
    annoyances: boolean
    cleanWeb: boolean
    youtubeDistractions: boolean
    youtubeRecommended: boolean
    youtubeShorts: boolean
  }
}

export const DEFAULT_SETTINGS: SettingsStorage = {
  version: 1.5,
  enabled: true,
  lists: {
    common: true,
    social: false,
    ipGrabbers: false,
    annoyances: true,
    cleanWeb: false,
    youtubeDistractions: true,
    youtubeRecommended: true,
    youtubeShorts: true,
  },
}

export const LATEST_SETTINGS_VERSION = DEFAULT_SETTINGS.version

export const normalizeSettings = (
  settings: Partial<SettingsStorage> = {}
): SettingsStorage => {
  const lists = {
    ...DEFAULT_SETTINGS.lists,
    ...(settings.lists || {}),
  }

  if (!settings.version || settings.version < 1.5) {
    lists.annoyances = true
    lists.youtubeDistractions = true
    lists.youtubeRecommended = true
    lists.youtubeShorts = true
  }

  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    version: LATEST_SETTINGS_VERSION,
    lists: {
      common: lists.common,
      social: lists.social,
      ipGrabbers: lists.ipGrabbers,
      annoyances: lists.annoyances,
      cleanWeb: lists.cleanWeb,
      youtubeDistractions: lists.youtubeDistractions,
      youtubeRecommended: lists.youtubeRecommended,
      youtubeShorts: lists.youtubeShorts,
    },
  }
}
