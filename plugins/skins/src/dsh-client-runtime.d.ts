declare module '@deepseek-ai/dsh-client-runtime/client' {
  export interface EngineStoreHandle<State> {
    readonly __state?: State
  }

  export function defineStore<State>(definition: {
    init: () => State
    actions: Record<string, (draft: State, ...args: any[]) => void>
  }): EngineStoreHandle<State>
}
