/// <reference types="web-ext-types"/>

import React, { Component } from 'react'
import { remoteFn } from '../../../backend/lib/remoteFunctions'

import {
  DEFAULT_SETTINGS,
  SettingsStorage,
  normalizeSettings,
} from '../../../constants/settings'
import { Button, Checkbox } from '../common'
import styles from './settings.module.css'

interface AppState {
  settings?: SettingsStorage
  hasChanged: boolean
  isRefreshingLists: boolean
}

class SettingsApp extends Component {
  state: AppState = { hasChanged: false, isRefreshingLists: false }

  componentDidMount(): void {
    this.fetchSettings()
  }

  /**
   * Retrieve extension information in an async manner
   *
   * @memberof SettingsApp
   */
  async fetchSettings(): Promise<void> {
    let settings = (await browser.storage.local.get('settings')).settings || {}

    // Check if settings exists
    if (JSON.stringify(settings) == '{}') {
      settings = DEFAULT_SETTINGS
      await browser.storage.local.remove('settings')
      await browser.storage.local.set({ settings })
    }

    settings = normalizeSettings(settings)

    this.setState({ hasChanged: this.state.hasChanged, settings })
  }

  toggleList(listId: keyof SettingsStorage['lists']): void {
    const settings = normalizeSettings(this.state.settings)

    settings.lists[listId] = !settings.lists[listId]
    this.setState({ hasChanged: true, settings })
  }

  render(): JSX.Element {
    const settings: SettingsStorage = this.state.settings

    return (
      <div className={styles.page}>
        <h1>Midori Privacy Adblock Settings</h1>

        {settings && (
          <>
            <div style={{ marginBottom: 16 }}>
              <Checkbox
                value={settings.enabled}
                onChange={() => {
                  settings.enabled = !settings.enabled
                  this.setState({ hasChanged: true, settings })
                }}
              >
                <>Enabled</>
              </Checkbox>
            </div>

            <h2>Filter lists</h2>
            <div style={{ marginBottom: 16 }}>
              <Checkbox
                value={settings.lists.fakeNews}
                onChange={() => this.toggleList('fakeNews')}
              >
                <>Fake news filter list</>
              </Checkbox>
              <Checkbox
                value={settings.lists.gambling}
                onChange={() => this.toggleList('gambling')}
              >
                <>Gambling filter list</>
              </Checkbox>
              <Checkbox
                value={settings.lists.social}
                onChange={() => this.toggleList('social')}
              >
                <>Social media filter list</>
              </Checkbox>
              <Checkbox
                value={settings.lists.ipGrabbers}
                onChange={() => this.toggleList('ipGrabbers')}
              >
                <>IP Grabbers filter list</>
              </Checkbox>
              <Checkbox
                value={settings.lists.annoyances}
                onChange={() => this.toggleList('annoyances')}
              >
                <>Annoyances</>
              </Checkbox>
              <Checkbox
                value={settings.lists.cleanWeb}
                onChange={() => this.toggleList('cleanWeb')}
              >
                <>Clean web</>
              </Checkbox>
              <Checkbox
                value={settings.lists.youtubeDistractions}
                onChange={() => this.toggleList('youtubeDistractions')}
              >
                <>YouTube distractions</>
              </Checkbox>
              <Checkbox
                value={settings.lists.youtubeRecommended}
                onChange={() => this.toggleList('youtubeRecommended')}
              >
                <>YouTube recommendations</>
              </Checkbox>
              <Checkbox
                value={settings.lists.youtubeShorts}
                onChange={() => this.toggleList('youtubeShorts')}
              >
                <>YouTube Shorts</>
              </Checkbox>
            </div>

            <Button
              onClick={async () => {
                await browser.storage.local.remove('settings')
                await browser.storage.local.set({ settings })
                await remoteFn('reloadBackend')
                this.setState({ ...this.state, hasChanged: false })
              }}
              disabled={!this.state.hasChanged}
            >
              <>Save Settings</>
            </Button>

            <div style={{ marginTop: 12 }}>
              <Button
                onClick={async () => {
                  this.setState({ ...this.state, isRefreshingLists: true })
                  await remoteFn('refreshFilterLists')
                  this.setState({
                    ...this.state,
                    hasChanged: false,
                    isRefreshingLists: false,
                  })
                }}
                disabled={this.state.hasChanged || this.state.isRefreshingLists}
              >
                <>
                  {this.state.isRefreshingLists
                    ? 'Updating filter lists...'
                    : 'Update filter lists now'}
                </>
              </Button>
            </div>
          </>
        )}
      </div>
    )
  }
}

export default SettingsApp
