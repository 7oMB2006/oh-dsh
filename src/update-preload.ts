import { contextBridge, ipcRenderer } from 'electron'
import type {
  DesktopUpdateBridge,
  DesktopUpdateCommand,
  DesktopUpdateState,
  RuntimeUpdateBridge,
  RuntimeUpdateCommand,
  RuntimeUpdateState,
} from './contracts.ts'

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

const runtimeCommandTypes = new Set<RuntimeUpdateCommand['type']>(['check', 'install', 'rollback'])

function isRuntimeCommand(value: unknown): value is RuntimeUpdateCommand {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && typeof value.type === 'string'
    && runtimeCommandTypes.has(value.type as RuntimeUpdateCommand['type'])
}

const runtimeBridge: RuntimeUpdateBridge = Object.freeze({
  getState: async (): Promise<RuntimeUpdateState> => await ipcRenderer.invoke('desktop:runtime-update:get-state') as RuntimeUpdateState,
  command: async (command: RuntimeUpdateCommand): Promise<RuntimeUpdateState> => {
    if (!isRuntimeCommand(command)) throw new Error('unsupported runtime update command')
    return await ipcRenderer.invoke('desktop:runtime-update:command', command) as RuntimeUpdateState
  },
  onState: (listener: (state: RuntimeUpdateState) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: RuntimeUpdateState): void => { listener(state) }
    ipcRenderer.on('desktop:runtime-update:state', wrapped)
    return () => { ipcRenderer.removeListener('desktop:runtime-update:state', wrapped) }
  },
})

contextBridge.exposeInMainWorld('dshDesktopRuntimeUpdate', runtimeBridge)