import React from 'react'
import {
  BarChart3,
  Gauge,
  LoaderCircle,
  Settings as SettingsIcon,
  ShieldCheck,
} from 'lucide-react'

import { BackendState } from '../../../constants/state'
import { Switch, Button, Favicon } from '../common'
import { AppState } from './state'
import styles from './style.module.css'
import { getAppContrast, rgbaToHex } from './contrast'

// =============================================================================
// Component types

type Props = {
  state: AppState
  toggleWhitelist: () => void
}

type Component = (arg0: Props) => JSX.Element

// =============================================================================
// Component

export const App: Component = ({ state, toggleWhitelist }) => {
  const textColor = getAppContrast(state.whitelisted, state.color)
  const summary = state.protectionSummary
  const activeProtection = summary?.enabled && !state.whitelisted
  const topBlockedDomains = state.blockedDomains.slice(0, 3)

  return (
    <div className={styles.container}>
      <main className={styles.header}>
        <div className={styles.itemBar}>
          <div style={{ justifyContent: 'flex-start' }}>
            <Switch
              state={!state.whitelisted}
              checkedColour={rgbaToHex(state.color || 'white')}
              backgroundColor={textColor}
              onChange={() => toggleWhitelist()}
            />
          </div>

          <div style={{ justifyContent: 'center' }}>
            <div className={styles.identity}>
              <Favicon icon={state.favicon} />
              <div>
                <strong>{state.activeDomain || 'Current tab'}</strong>
                <span>
                  {activeProtection ? 'Protected' : 'Protection paused'}
                </span>
              </div>
            </div>
          </div>

          <div style={{ justifyContent: 'flex-end' }}>
            <button
              className={styles.iconButton}
              onClick={() => window.open('./settings.html')}
              type="button"
              aria-label="Open settings"
            >
              <SettingsIcon size={18} />
            </button>
          </div>
        </div>

        <div className={styles.hero}>
          <ShieldCheck size={34} />
          <div>
            <h1>{state.blocked}</h1>
            <p>blocked on this tab</p>
          </div>
        </div>
      </main>

      <div className={styles.controls}>
        {state.backgroundState === BackendState.Loading && (
          <div className={`${styles.info} ${styles.loading}`}>
            <span>
              <LoaderCircle size={16} />
              Loading blocker engine
            </span>
          </div>
        )}

        <section className={styles.panel}>
          <header>
            <Gauge size={16} />
            <h2>Top blocked on this tab</h2>
          </header>
          {topBlockedDomains.length > 0 ? (
            <div className={styles.domainList}>
              {topBlockedDomains.map((item) => (
                <div key={item.url}>
                  <span>{item.url}</span>
                  <strong>{item.num}</strong>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.empty}>No blocked requests on this tab yet.</p>
          )}
        </section>

        <div className={styles.actions}>
          <Button
            onClick={toggleWhitelist}
            isPrimary={!state.whitelisted}
            style={{
              backgroundColor: state.whitelisted ? 'transparent' : undefined,
            }}
          >
            <>
              {state.whitelisted ? 'Resume protection' : 'Pause on this site'}
            </>
          </Button>
          <Button
            onClick={() => window.open('./stats.html')}
            style={{
              backgroundColor: 'transparent',
              color: 'var(--text-primary)',
            }}
          >
            <>
              <BarChart3 size={15} />
              Statistics
            </>
          </Button>
        </div>
      </div>
    </div>
  )
}
