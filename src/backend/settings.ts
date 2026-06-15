import {
  DEFAULT_SETTINGS,
  LATEST_SETTINGS_VERSION,
  SettingsStorage,
} from '../constants/settings'
import { PermStore } from './permStore'

export class Settings extends PermStore<SettingsStorage> {
  constructor() {
    super('settings', DEFAULT_SETTINGS)
  }

  protected async loadData(defaultData: SettingsStorage): Promise<void> {
    await super.loadData(defaultData)

    // Update settings if it is outdated
    if (this.data.version < LATEST_SETTINGS_VERSION) {
      this.data = { ...this.data, ...DEFAULT_SETTINGS }
      this.data.version = LATEST_SETTINGS_VERSION
    }
  }

  async load(): Promise<void> {
    // Check if data has already been loaded. If it has, then restart the loading
    // process
    if (this.memData) {
      // Clear memData
      delete this.memData
      // Restart the loading process
      this.loadingPromise = this.loadData(DEFAULT_SETTINGS)
    }

    // Call the parents class load logic
    await super.load()
  }

  async checkLoad(): Promise<void> {
    await super.load()
  }
}
