const tempPort = (
  id: string,
  onInstance: (port: browser.runtime.Port) => void | Promise<void>,
  setVar?: (val: browser.runtime.Port | undefined) => void
): void => {
  const connected = (p: browser.runtime.Port) => {
    if (p.name === id) {
      if (setVar) setVar(p)
      onInstance(p)

      p.onDisconnect.addListener(() => {
        if (setVar) setVar(undefined)
      })
    }
  }

  browser.runtime.onConnect.addListener(connected)
}

export const sleep = (duration: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, duration))

export default tempPort
