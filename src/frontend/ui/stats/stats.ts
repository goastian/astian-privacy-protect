import { Chart, registerables } from 'chart.js'
import { remoteFn } from '../../../backend/lib/remoteFunctions'

import '../common/common.css'

Chart.register(...registerables)

type StatsPayload = Record<string, number>

type StatPoint = {
  key: string
  date: Date
  label: string
  count: number
}

const BLOCKED_REQUEST_TIME_SAVED_SECONDS = 3
const BLOCKED_REQUEST_BANDWIDTH_SAVED_BYTES = 45 * 1024

const numberFormatter = new Intl.NumberFormat()
const compactFormatter = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
})
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
})

const themeColor = getComputedStyle(document.documentElement)
  .getPropertyValue('--color')
  .trim()
const secondaryColor = getComputedStyle(document.documentElement)
  .getPropertyValue('--color-secondary')
  .trim()
const borderColor = getComputedStyle(document.documentElement)
  .getPropertyValue('--border')
  .trim()

Chart.defaults.color = themeColor

// Get the canvas context that will be used to draw the chart
const ctx = (
  document.getElementById('blockedTime') as HTMLCanvasElement
).getContext('2d')

const getElement = (id: string) => document.getElementById(id) as HTMLElement

const totalBlockedEl = getElement('totalBlocked')
const totalTimeEl = getElement('totalTime')
const totalBandwidthEl = getElement('totalBandwidth')
const activeDaysEl = getElement('activeDays')
const bestDayEl = getElement('bestDay')
const averageDailyEl = getElement('averageDaily')
const summaryTextEl = getElement('summaryText')
const recentRowsEl = getElement('recentRows')
const emptyStateEl = getElement('emptyState')

const parseStatDate = (key: string) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    return new Date(`${key}T00:00:00`)
  }

  const legacyParts = key.split('/').map((part) => Number(part))
  if (legacyParts.length === 3 && legacyParts.every(Number.isFinite)) {
    const [day, zeroBasedMonth, year] = legacyParts
    return new Date(year, zeroBasedMonth, day)
  }

  return new Date(key)
}

const buildPoints = (payload: StatsPayload): StatPoint[] =>
  Object.entries(payload)
    .map(([key, count]) => {
      const date = parseStatDate(key)
      return {
        key,
        date,
        label: Number.isNaN(date.getTime()) ? key : dateFormatter.format(date),
        count: Number(count) || 0,
      }
    })
    .filter((point) => point.count > 0)
    .sort((first, second) => first.date.getTime() - second.date.getTime())

const formatDuration = (seconds: number) => {
  if (seconds < 60) return `${Math.round(seconds)} sec`

  const minutes = seconds / 60
  if (minutes < 60) return `${Math.round(minutes)} min`

  const hours = minutes / 60
  if (hours < 24) return `${hours.toFixed(1)} h`

  return `${(hours / 24).toFixed(1)} d`
}

const formatBytes = (bytes: number) => {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

const renderRecentRows = (points: StatPoint[]) => {
  const recentPoints = points.slice(-7).reverse()
  const maxCount = Math.max(...recentPoints.map((point) => point.count), 1)

  recentRowsEl.innerHTML = ''
  recentPoints.forEach((point) => {
    const row = document.createElement('div')
    row.className = 'recent-row'

    const date = document.createElement('span')
    date.textContent = point.label

    const bar = document.createElement('div')
    bar.className = 'recent-bar'
    const fill = document.createElement('span')
    fill.style.width = `${Math.max(6, (point.count / maxCount) * 100)}%`
    bar.append(fill)

    const count = document.createElement('span')
    count.className = 'recent-count'
    count.textContent = numberFormatter.format(point.count)

    row.append(date, bar, count)
    recentRowsEl.append(row)
  })
}

const renderChart = (points: StatPoint[]) => {
  if (!ctx) return

  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: points.map((point) => point.label),
      datasets: [
        {
          backgroundColor: '#0f9d7a',
          borderColor: '#0f9d7a',
          borderRadius: 5,
          borderSkipped: false,
          label: 'Blocked requests',
          data: points.map((point) => point.count),
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          callbacks: {
            label: (item) =>
              `${numberFormatter.format(Number(item.raw) || 0)} blocked requests`,
          },
        },
      },
      scales: {
        x: {
          grid: {
            display: false,
          },
          ticks: {
            color: secondaryColor || themeColor,
            maxRotation: 0,
            autoSkip: true,
          },
        },
        y: {
          beginAtZero: true,
          suggestedMax:
            Math.max(...points.map((point) => point.count), 1) * 1.2,
          grid: {
            color: borderColor || 'rgba(128, 128, 128, 0.2)',
          },
          ticks: {
            color: secondaryColor || themeColor,
            precision: 0,
            callback: (value) => compactFormatter.format(Number(value)),
          },
        },
      },
    },
  })
}

;(async () => {
  const payload = (await remoteFn('getLongTermStats')) as StatsPayload
  const points = buildPoints(payload)
  const chartPoints = points.slice(-30)
  const totalBlocked = points.reduce((total, point) => total + point.count, 0)
  const bestDay = points.reduce(
    (best, point) => (point.count > best.count ? point : best),
    { count: 0, label: '--' } as Pick<StatPoint, 'count' | 'label'>
  )
  const activeDays = points.length
  const dailyAverage =
    activeDays > 0 ? Math.round(totalBlocked / activeDays) : 0

  totalBlockedEl.textContent = numberFormatter.format(totalBlocked)
  activeDaysEl.textContent = numberFormatter.format(activeDays)
  bestDayEl.textContent = bestDay.count
    ? `${numberFormatter.format(bestDay.count)} on ${bestDay.label}`
    : '--'
  averageDailyEl.textContent = dailyAverage
    ? numberFormatter.format(dailyAverage)
    : '--'
  totalTimeEl.textContent = formatDuration(
    totalBlocked * BLOCKED_REQUEST_TIME_SAVED_SECONDS
  )
  totalBandwidthEl.textContent = formatBytes(
    totalBlocked * BLOCKED_REQUEST_BANDWIDTH_SAVED_BYTES
  )
  summaryTextEl.textContent = totalBlocked
    ? `${numberFormatter.format(totalBlocked)} requests blocked across ${numberFormatter.format(activeDays)} active day${activeDays === 1 ? '' : 's'}.`
    : 'No blocking activity has been recorded yet.'

  emptyStateEl.hidden = points.length > 0
  if (points.length > 0) {
    renderChart(chartPoints)
    renderRecentRows(points)
  }
})()
