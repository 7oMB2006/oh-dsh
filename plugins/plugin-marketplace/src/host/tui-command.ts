interface CommandService {
  register(definition: {
    name: string
    description: string
    input?: { hint: string }
    handler(): { kind: 'success' } | { kind: 'error'; text: string }
  }): () => void
}

/** Slash command opening the shared TUI marketplace surface. */
export function mountMarketplaceTuiCommand(
  commands: CommandService,
): () => void {
  const language = process.env.OH_DSH_TUI_LANG ?? process.env.CC_TUI_LANG ?? 'zh'
  const zh = language.toLowerCase().startsWith('zh')
  return commands.register({
    name: 'plugins',
    description: zh
      ? '打开插件市场：搜索、预览、安装与管理插件'
      : 'Open the plugin marketplace: search, preview, install, and manage plugins',
    input: { hint: 'plugins' },
    // The TUI renderer owns catalog loading when it opens the overlay.
    // Returning without a refresh avoids racing the controller's load.
    handler: () => ({ kind: 'success' }),
  })
}
