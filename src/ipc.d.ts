interface TabInfo {
  path: string
  stale?: boolean
}

interface ViewerBridge {
  onTabsChanged: (
    cb: (data: { tabs: TabInfo[]; activePath: string | null }) => void,
  ) => () => void
  onContentUpdated: (cb: (data: { path: string; content: string }) => void) => () => void
  onFileChanged: (cb: (data: { path: string }) => void) => () => void
  reloadTab: (path: string) => Promise<void>
  dismissFileChanged: (path: string) => Promise<void>
  getState: () => Promise<{ tabs: TabInfo[]; activePath: string | null }>
  getTabContent: (path: string) => Promise<string | null>
  activateTab: (path: string) => Promise<void>
  closeTab: (path: string) => Promise<void>
  openPath: (filePath: string) => Promise<void>
  pathForFile: (file: File) => string
  setThemeSource: (source: 'system' | 'light' | 'dark') => Promise<void>
  saveFile: (
    filePath: string,
    content: string,
  ) => Promise<{ ok: boolean; error?: string }>
  resolveEmbed: (baseDir: string, ref: string) => Promise<string | null>
  readEmbed: (filePath: string) => Promise<{ ok: boolean; content?: string; error?: string }>
  exportPdf: (opts?: {
    autoPath?: string
  }) => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>
}

declare global {
  interface Window {
    viewer: ViewerBridge
  }
}

export {}
