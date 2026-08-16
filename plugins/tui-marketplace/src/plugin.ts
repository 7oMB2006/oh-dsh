/**
 * Downstream TUI renderer adapter.
 *
 * This module mirrors the pinned `dsh-cc-tui` front door (see
 * upstream/dsh-TUI/src/plugin.ts) and wraps its Chat tree with the shared
 * plugin marketplace overlay. Upstream source is imported, not modified;
 * the existing `scripts/tui-upstream-adapter.mjs` branding seams are kept
 * intact for the staged upstream package.
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import React from 'react'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import * as toolAskUser from '@deepseek-ai/dsh-tool-ask-user'
import type { Context } from '@deepseek-ai/cordis'
import type { Config } from '../../../upstream/dsh-TUI/src/index.ts'
import { createChannel } from '../../../upstream/dsh-TUI/src/channel.ts'
import { QuestionStore } from '../../../upstream/dsh-TUI/src/questions.ts'
import { registerPackagedSkills } from '../../../upstream/dsh-TUI/src/packaged-skills.ts'
import { readActivityFrames } from '../../../upstream/dsh-TUI/src/activityPrefs.ts'
import { readModelPref } from '../../../upstream/dsh-TUI/src/modelPrefs.ts'
import { readPresetPref } from '../../../upstream/dsh-TUI/src/presetPrefs.ts'
import { composePreset, resolvePersistedPreset, runningPresetOf } from '../../../upstream/dsh-TUI/src/presets.ts'
import { writeResumeTarget } from '../../../upstream/dsh-TUI/src/sessionHistory.ts'
import { isLang, resolveStartupLang, setLang } from '../../../upstream/dsh-TUI/src/i18n.ts'
import { Chat } from '../../../upstream/dsh-TUI/src/screens/Chat.tsx'
import { render, ThemeProvider, AlternateScreen } from '../../../upstream/dsh-TUI/src/ui.ts'
import type { PluginMarketplaceBridge } from '../../plugin-marketplace/src/protocol.ts'
import {
  createMarketplaceOpenStore,
  TuiMarketplaceController,
} from './marketplace-controller.ts'
import { TuiMarketplaceShell } from './marketplace.tsx'

/**
 * Oh-DSH TUI front door over the pinned dsh-TUI renderer, with the shared
 * plugin marketplace surface attached to the same agent/channel tree.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  if (process.env.OH_DSH_TUI_MARKETPLACE_PREVIEW_PROBE === '1') {
    // Headless preview activation: every row before this front door has
    // already applied. Requiring the marketplace service here makes a
    // candidate that broke host activation fail before the user applies it.
    if (ctx.get('pluginMarketplace') === undefined) {
      throw new Error('plugin marketplace host did not activate in the preview profile')
    }
    await new Promise<void>(resolve => { setImmediate(resolve) })
    process.exit(0)
  }
  if (!process.stdout.isTTY) {
    throw new Error('Oh-DSH TUI requires an interactive terminal (stdout must be a TTY).')
  }

  const envLang = process.env.CC_TUI_LANG
  setLang(isLang(envLang) ? envLang : isLang(config.lang) ? config.lang : resolveStartupLang())

  const userQuestions = ctx.get('userQuestions') ?? new UserQuestionService(ctx)
  ctx.plugin(toolAskUser)
  const questionStore = new QuestionStore()
  registerPackagedSkills(ctx)
  userQuestions.registerProvider({
    ask: request => questionStore.ask(request),
  })
  ctx.effect(() => () => questionStore.rejectAll())

  const agentOptions = {
    provider: config.provider,
    model: config.model,
  }
  const meta = { cwd: config.cwd ?? process.cwd() }
  const { agent, handle, agentPreset } = await resolveAgent(
    ctx,
    config.sessionId,
    agentOptions,
    meta,
    config.preset,
  )

  const modelPref = readModelPref()
  const channel = createChannel(ctx, agent, {
    model: config.model ?? modelPref?.model ?? 'deepseek-v4-flash',
    cwd: config.cwd ?? process.cwd(),
    provider: config.provider ?? modelPref?.provider ?? 'deepseek-official',
    configuredModel: config.model,
    configuredProvider: config.provider,
    effort: config.effort,
    activity: config.activity,
    activityFrames: config.activityFrames ?? readActivityFrames() ?? 'claude',
    contextBar: config.contextBar,
    configuredPreset: config.preset,
    agentPreset,
    handle,
  })

  const openStore = createMarketplaceOpenStore()
  const bridge = ctx.get('pluginMarketplace') as PluginMarketplaceBridge | undefined
  const controller = bridge === undefined
    ? null
    : new TuiMarketplaceController(bridge, () => {
      try {
        writeResumeTarget(channel.agentId)
        const dataRoot = process.env.DSH_OH_TUI_HOME ?? process.env.OH_DSH_HOME
        if (dataRoot !== undefined && dataRoot !== '') {
          const directory = join(dataRoot, 'tui')
          mkdirSync(directory, { recursive: true })
          writeFileSync(join(directory, 'marketplace-resume'), channel.agentId)
        }
      } catch {
        // Best effort; the launcher resume marker must never block apply.
      }
    })
  const disposeCommandOpener = ctx.on('session/event', (session, event) => {
    if (session !== agent.session) return
    const type = (event as { type?: string }).type
    if (type === 'command/run') {
      const name = (event as { data?: { name?: string } }).data?.name
      if (name === 'plugins') {
        openStore.open()
        void controller?.load()
      }
    }
  })
  ctx.effect(() => disposeCommandOpener, 'oh-dsh-tui-marketplace: command opener')

  let instance: Awaited<ReturnType<typeof render>> | undefined
  let exited = false
  const handleExit = (error?: unknown): void => {
    if (exited) return
    exited = true
    try {
      writeResumeTarget(channel.agentId)
    } catch {
      // Best effort — the resume marker is a launcher nicety.
    }
    try {
      instance?.unmount()
    } catch {
      // The terminal state may already be gone (broken pipe, alt session).
    }
    if (error !== undefined) {
      const message = error instanceof Error ? error.message : String(error)
      ctx.logger.error(`Oh-DSH TUI: exit after error: ${message}`)
      if (process.stderr.isTTY) {
        process.stderr.write(`\nOh-DSH TUI crashed: ${message}\n`)
      }
      disposeRootAndExit(ctx, 1)
      return
    }
    if (process.stdout.isTTY) {
      process.stdout.write(`\nResume with:\nohdsh tui --resume ${channel.agentId}\n\n`)
    }
    disposeRootAndExit(ctx, 0)
  }

  const chat = React.createElement(Chat, {
    channel,
    questionStore,
    onExit: () => handleExit(),
  })
  const shell = controller === null
    ? chat
    : React.createElement(TuiMarketplaceShell, {
      channel,
      controller,
      onExit: () => handleExit(),
      openStore,
      questionStore,
    })
  const tree = React.createElement(
    ThemeProvider,
    null,
    config.fullscreen ? React.createElement(AlternateScreen, null, shell) : shell,
  )
  instance = await render(tree, { exitOnCtrlC: false })

  ctx.effect(() => () => {
    instance?.unmount()
  })

  void instance.waitUntilExit().then(handleExit, handleExit)
}

/**
 * Attach to an existing agent, resume a persisted session, or create one.
 * Mirrors the pinned upstream resolver so Oh-DSH keeps the same preset and
 * model-route precedence.
 */
async function resolveAgent(
  ctx: Context,
  requestedSessionId: string | undefined,
  agentOptions: { provider?: string; model?: string },
  meta: { cwd: string },
  configuredPreset?: string,
): Promise<{ agent: Agent; handle?: AgentHandle; agentPreset?: string }> {
  if (requestedSessionId !== undefined) {
    const resumeId = SessionId(requestedSessionId)
    const existing = ctx.agents.get(resumeId)
    if (existing !== undefined) {
      return { agent: existing, agentPreset: runningPresetOf(existing.session) }
    }
    try {
      const persisted = await resolvePersistedPreset(ctx, resumeId)
      const composed = await composePreset(ctx, persisted)
      const resumed = await ctx.agents.resume({
        resumeSessionId: resumeId,
        agentOptions,
        ...(composed.setup === undefined ? {} : { setup: composed.setup }),
      })
      return { agent: resumed.agent, handle: resumed, agentPreset: composed.agentPreset }
    } catch (error) {
      ctx.logger.warn(
        `Oh-DSH TUI: resume of "${requestedSessionId}" failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  const sessionId = SessionId(randomUUID())
  const composed = await composePreset(ctx, configuredPreset ?? readPresetPref())
  const modelPref = readModelPref()
  const route = {
    provider: agentOptions.provider ?? modelPref?.provider,
    model: agentOptions.model ?? modelPref?.model,
  }
  const created = await ctx.agents.create({
    sessionId,
    meta: {
      ...meta,
      ...(composed.agentPreset === undefined ? {} : { agentPreset: composed.agentPreset }),
    },
    agentOptions: route,
    ...(composed.setup === undefined ? {} : { setup: composed.setup }),
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Oh-DSH TUI: failed to create agent (provider=${route.provider ?? 'deepseek-official'}, model=${route.model ?? 'deepseek-v4-flash'}): ${message}`,
    )
  })
  return { agent: created.agent, handle: created, agentPreset: composed.agentPreset }
}

/** Dispose the whole application before process exit, with a bounded fallback. */
function disposeRootAndExit(ctx: Context, code: number): void {
  const timer = setTimeout(() => process.exit(code), 5000)
  timer.unref()
  void ctx.root.fiber.dispose().then(
    () => {
      clearTimeout(timer)
      process.exit(code)
    },
    () => {
      clearTimeout(timer)
      process.exit(code)
    },
  )
}
