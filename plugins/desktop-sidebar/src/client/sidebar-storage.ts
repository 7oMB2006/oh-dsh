import {
  parseSidebarPreferences,
  SIDEBAR_PREFERENCES_API_PATH,
  type DesktopSidebarPreferences,
} from '../sidebar-preferences.ts'

interface FetchResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

export type SidebarPreferencesFetch = (
  input: string,
  init?: { body?: string; headers?: Record<string, string>; method?: string },
) => Promise<FetchResponse>

export interface SidebarPreferencesStorage {
  load(): Promise<DesktopSidebarPreferences>
  save(preferences: DesktopSidebarPreferences): Promise<void>
}

export class HttpSidebarPreferencesStorage
implements SidebarPreferencesStorage {
  private readonly request: SidebarPreferencesFetch

  constructor(request: SidebarPreferencesFetch) {
    this.request = request
  }

  async load(): Promise<DesktopSidebarPreferences> {
    const response = await this.request(SIDEBAR_PREFERENCES_API_PATH)
    if (!response.ok) {
      throw new Error(`sidebar preferences load failed (${String(response.status)})`)
    }
    const preferences = parseSidebarPreferences(await response.json())
    if (preferences === undefined) {
      throw new Error('sidebar preferences response is invalid')
    }
    return preferences
  }

  async save(preferences: DesktopSidebarPreferences): Promise<void> {
    const response = await this.request(SIDEBAR_PREFERENCES_API_PATH, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(preferences),
    })
    if (!response.ok) {
      throw new Error(`sidebar preferences save failed (${String(response.status)})`)
    }
  }
}
