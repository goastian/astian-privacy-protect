export type SettingsStorage = {
  version: 1.3
  enabled: boolean
  lists: {
    common: boolean
    fakeNews: boolean
    gambling: boolean
    social: boolean
    ipGrabbers: boolean
    annoyances: boolean
    cleanWeb: boolean
  }
}

export const DEFAULT_SETTINGS: SettingsStorage = {
  version: 1.3,
  enabled: true,
  lists: {
    common: true,
    fakeNews: false,
    gambling: false,
    social: false,
    ipGrabbers: false,
    annoyances: false,
    cleanWeb: false,
  },
}

export const LATEST_SETTINGS_VERSION = DEFAULT_SETTINGS.version
