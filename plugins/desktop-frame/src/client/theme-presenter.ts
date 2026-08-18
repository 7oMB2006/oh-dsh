const DARK_ATTRIBUTE = 'data-ds-dark-theme'

interface ThemeSnapshot {
  active: {
    colorScheme: 'light' | 'dark'
    tokens: Readonly<Record<string, string>>
  }
}

/** Projects DSH theme tokens onto the document for the replacement root frame. */
export class DesktopFrameThemePresenter {
  private appliedTokens: string[] = []
  private readonly themeColorMeta: HTMLMetaElement

  constructor() {
    this.themeColorMeta = document.createElement('meta')
    this.themeColorMeta.name = 'theme-color'
  }

  apply(snapshot: ThemeSnapshot): void {
    document.documentElement.style.colorScheme = snapshot.active.colorScheme
    if (snapshot.active.colorScheme === 'dark') document.body.setAttribute(DARK_ATTRIBUTE, '')
    else document.body.removeAttribute(DARK_ATTRIBUTE)
    for (const name of this.appliedTokens) document.body.style.removeProperty(name)
    this.appliedTokens = []
    for (const [name, value] of Object.entries(snapshot.active.tokens)) {
      document.body.style.setProperty(name, value)
      this.appliedTokens.push(name)
    }
    this.themeColorMeta.content = getComputedStyle(document.body).backgroundColor
    if (!this.themeColorMeta.isConnected) document.head.append(this.themeColorMeta)
  }

  dispose(): void {
    document.documentElement.style.removeProperty('color-scheme')
    document.body.removeAttribute(DARK_ATTRIBUTE)
    for (const name of this.appliedTokens) document.body.style.removeProperty(name)
    this.appliedTokens = []
    this.themeColorMeta.remove()
  }
}
