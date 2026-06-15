export type SettingsStorage = {
  version: 1.4
  enabled: boolean
  lists: {
    common: boolean
    fakeNews: boolean
    gambling: boolean
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
  version: 1.4,
  enabled: true,
  lists: {
    common: true,
    fakeNews: false,
    gambling: false,
    social: false,
    ipGrabbers: false,
    annoyances: false,
    cleanWeb: false,
    youtubeDistractions: false,
    youtubeRecommended: false,
    youtubeShorts: false,
  },
}

export const LATEST_SETTINGS_VERSION = DEFAULT_SETTINGS.version

export const normalizeSettings = (
  settings: Partial<SettingsStorage> = {}
): SettingsStorage => ({
  ...DEFAULT_SETTINGS,
  ...settings,
  version: LATEST_SETTINGS_VERSION,
  lists: {
    ...DEFAULT_SETTINGS.lists,
    ...(settings.lists || {}),
  },
})
