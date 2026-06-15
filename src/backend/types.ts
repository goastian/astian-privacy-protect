export type RequestListenerArgs = {
  requestId: string
  url: string
  method: string
  frameId: number
  parentFrameId: number
  requestBody?: {
    error?: string
    formData?: {
      [key: string]: string[]
    }
    raw?: browser.webRequest.UploadData[]
  }
  tabId: number
  type: browser.webRequest.ResourceType
  timeStamp: number
  originUrl?: string
  documentUrl?: string
  initiator?: string
}
