/// <reference types="web-ext-types"/>

import React, { Component } from 'react'
import { remoteFn } from '../../../backend/lib/remoteFunctions'

import { DEFAULT_SETTINGS, SettingsStorage } from '../../../constants/settings'
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

    this.setState({ hasChanged: this.state.hasChanged, settings })
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
                onChange={() => {
                  settings.lists.fakeNews = !settings.lists.fakeNews
                  this.setState({ hasChanged: true, settings })
                }}
              >
                <>Fake news filter list</>
              </Checkbox>
              <Checkbox
                value={settings.lists.gambling}
                onChange={() => {
                  settings.lists.gambling = !settings.lists.gambling
                  this.setState({ hasChanged: true, settings })
                }}
              >
                <>Gambling filter list</>
              </Checkbox>
              <Checkbox
                value={settings.lists.social}
                onChange={() => {
                  settings.lists.social = !settings.lists.social
                  this.setState({ hasChanged: true, settings })
                }}
              >
                <>Social media filter list</>
              </Checkbox>
              <Checkbox
                value={settings.lists.ipGrabbers}
                onChange={() => {
                  settings.lists.ipGrabbers = !settings.lists.ipGrabbers
                  this.setState({ hasChanged: true, settings })
                }}
              >
                <>IP Grabbers filter list</>
              </Checkbox>
              <Checkbox
                value={settings.lists.annoyances}
                onChange={() => {
                  settings.lists.annoyances = !settings.lists.annoyances
                  this.setState({ hasChanged: true, settings })
                }}
              >
                <>Annoyances</>
              </Checkbox>
              <Checkbox
                value={settings.lists.cleanWeb}
                onChange={() => {
                  settings.lists.cleanWeb = !settings.lists.cleanWeb
                  this.setState({ hasChanged: true, settings })
                }}
              >
                <>Clean web</>
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
