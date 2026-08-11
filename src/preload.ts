import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopBridge, DesktopCommand, DesktopInfo, DesktopRuntimeSnapshot } from './contracts.ts'

const bridge: DesktopBridge = Object.freeze({
  chooseWorkspace: async (): Promise<string[]> => {
    return await ipcRenderer.invoke('desktop:choose-workspace') as string[]
  },
  getInfo: async (): Promise<DesktopInfo> => await ipcRenderer.invoke('desktop:get-info') as DesktopInfo,
  getRuntimeSnapshot: async (): Promise<DesktopRuntimeSnapshot> => {
    return await ipcRenderer.invoke('desktop:get-runtime-snapshot') as DesktopRuntimeSnapshot
  },
  onCommand: (listener: (command: DesktopCommand) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, command: DesktopCommand): void => { listener(command) }
    ipcRenderer.on('desktop:command', wrapped)
    return () => { ipcRenderer.removeListener('desktop:command', wrapped) }
  },
  openExternal: async (url: string): Promise<void> => {
    await ipcRenderer.invoke('desktop:open-external', url)
  },
})

contextBridge.exposeInMainWorld('dshDesktop', bridge)
