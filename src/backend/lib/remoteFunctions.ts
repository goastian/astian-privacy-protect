import { v4 as uuidv4 } from 'uuid'

import tempPort from '../tempPort'

type CallFunctionData = {
  name: string
  payload?: unknown
  id: string
}
type FunctionReturnData = {
  payload: unknown
  id: string
}

const functions = {}

export const initFn = (): void =>
  tempPort('co.dothq.shield.fn', (p) =>
    p.onMessage.addListener(async (msg: CallFunctionData) => {
      if (typeof functions[msg.name] === 'undefined') {
        throw new Error(
          `The function ${msg.name} has not been defined (yet). Please make sure that it is defined before use`
        )
      } else {
        p.postMessage({
          id: msg.id,
          payload: await functions[msg.name](msg.payload),
        })
      }
    })
  )

export const remoteFn = (name: string, payload?: unknown): Promise<unknown> => {
  const id = uuidv4()

  const backend = browser.runtime.connect({
    name: 'co.dothq.shield.fn',
  })

  const promise = new Promise((resolve) => {
    backend.onMessage.addListener(function (msg: FunctionReturnData) {
      if (msg.id === id) {
        // This message is the correct return
        resolve(msg.payload)
      }
    })
  })

  backend.postMessage({ id, name, payload })

  return promise
}

export const defineFn = (
  name: string,
  callback: (payload: unknown) => Promise<unknown>
): void => {
  functions[name] = callback
}
