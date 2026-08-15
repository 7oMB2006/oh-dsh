import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopUpdateBridge, DesktopUpdateCommand, DesktopUpdateState } from './contracts.ts'

const commandTypes = new Set<DesktopUpdateCommand['type']>([
  'check',
  'download',
  'cancel',
  'retry',
  'install-now',
  'install-on-quit',
  'open-release',
])

function isCommand(value: unknown): value is DesktopUpdateCommand {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && typeof value.type === 'string'
    && commandTypes.has(value.type as DesktopUpdateCommand['type'])
}

const bridge: DesktopUpdateBridge = Object.freeze({
  getState: async (): Promise<DesktopUpdateState> => await ipcRenderer.invoke('desktop:update:get-state') as DesktopUpdateState,
  command: async (command: DesktopUpdateCommand): Promise<DesktopUpdateState> => {
    if (!isCommand(command)) throw new Error('unsupported update command')
    return await ipcRenderer.invoke('desktop:update:command', command) as DesktopUpdateState
  },
  onState: (listener: (state: DesktopUpdateState) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: DesktopUpdateState): void => { listener(state) }
    ipcRenderer.on('desktop:update:state', wrapped)
    return () => { ipcRenderer.removeListener('desktop:update:state', wrapped) }
  },
})

contextBridge.exposeInMainWorld('dshDesktopUpdate', bridge)
