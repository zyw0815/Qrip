export interface ElectronAPI {
  openOAuth(url: string): Promise<string | null>
  getStoreValue(key: string): Promise<unknown>
  setStoreValue(key: string, value: unknown): Promise<boolean>
  deleteStoreValue(key: string): Promise<boolean>
  onPythonStatus(cb: (status: string) => void): void
  getDownloadPath(): Promise<string>
  pickFolder(): Promise<string | null>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
