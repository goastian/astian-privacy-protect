/* eslint-disable no-console */
const shouldLog = process.env.NODE_ENV !== 'production'

export const println = (message: string): void => {
  if (shouldLog) console.log(message)
}

export const timeStart = (message: string): void => {
  if (shouldLog) console.time(message)
}

export const timeEnd = (message: string): void => {
  if (shouldLog) console.timeEnd(message)
}
