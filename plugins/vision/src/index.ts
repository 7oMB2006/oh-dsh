/** Cross-surface image understanding through an OpenAI-compatible VLM. */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import {
  hasBrowserSurface,
  OH_DSH_SURFACE_SERVICE,
  type OhDshSurface,
} from '../../shared/surface.ts'
import { VisionAttachmentRegistry } from './attachment-registry.ts'
import { mountVisionAttachmentServer } from './attachment-server.ts'
import {
  VISION_ATTACHMENT_SCHEME,
  visionAttachmentToken,
  type VisionAttachmentRef,
} from './protocol.ts'
import { isRetriableVisionError, visionChat } from './vlm.ts'

export const name = 'oh-dsh-vision'
export const inject = ['attachments', 'credentials', 'systemPrompt', 'tools']

export const DEFAULT_VISION_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4'
export const DEFAULT_VISION_MODEL = 'glm-4.6v-flash'
export const DEFAULT_VISION_API_KEY_REF = 'VISION_API_KEY'
export const DEFAULT_FREE_FALLBACKS = Object.freeze([
  'glm-4.1v-thinking-flash',
  'glm-4v-flash',
] as const)

const DEFAULT_MAX_TOKENS = 2048
const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_TIMEOUT_MS = 300_000
const SETTINGS_NAMESPACE = settingsNamespace('oh-dsh-vision')

/** Shared vision configuration for Desktop, Web, and TUI. */
export interface Config {
  apiKey?: string
  apiKeyEnv?: string
  baseURL?: string
  fallbackModels?: string[]
  maxImageBytes?: number
  maxTokens?: number
  model?: string
  timeoutMs?: number
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret').default('')
    .description('Literal API key; prefer apiKeyEnv and the DSH credential store'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_VISION_API_KEY_REF)
    .description('Credential reference resolved for each image request'),
  baseURL: z.string().default(DEFAULT_VISION_BASE_URL)
    .description('OpenAI-compatible endpoint base URL; /chat/completions is appended'),
  fallbackModels: z.array(z.string()).default([])
    .description('Models tried after a 404, 429, or 5xx response'),
  maxImageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_IMAGE_BYTES),
  maxTokens: z.number().step(1).min(1).max(32_768).default(DEFAULT_MAX_TOKENS),
  model: z.string().default(DEFAULT_VISION_MODEL),
  timeoutMs: z.number().step(1).min(1_000).max(MAX_TIMEOUT_MS).default(DEFAULT_TIMEOUT_MS),
})

/** Fully validated facts for one image request. */
export interface ResolvedVisionConfig {
  apiKey: string
  apiKeyEnv: string
  baseURL: string
  fallbackModels: string[]
  maxImageBytes: number
  maxTokens: number
  model: string
  timeoutMs: number
}

interface VisionAttachmentReader {
  readImage(ref: VisionAttachmentRef, signal?: AbortSignal): Promise<{
    data: Uint8Array
    ref: VisionAttachmentRef
  }>
}

function positiveInteger(value: number, name: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`oh-dsh-vision: ${name} must be a positive integer no greater than ${maximum}`)
  }
  return value
}

/** Resolve schema defaults and re-judge programmatic configuration. */
export function resolveVisionConfig(config: Config): ResolvedVisionConfig {
  const baseURL = config.baseURL ?? DEFAULT_VISION_BASE_URL
  let endpoint: URL
  try {
    endpoint = new URL(baseURL)
  } catch {
    throw new Error(`oh-dsh-vision: invalid baseURL ${JSON.stringify(baseURL)}`)
  }
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
    throw new Error('oh-dsh-vision: baseURL must use http or https')
  }
  const model = config.model ?? DEFAULT_VISION_MODEL
  if (model.trim() === '') throw new Error('oh-dsh-vision: model must be non-empty')
  const apiKeyEnv = config.apiKeyEnv ?? DEFAULT_VISION_API_KEY_REF
  credentialRef(apiKeyEnv)
  const explicitFallbacks = config.fallbackModels ?? []
  if (explicitFallbacks.some(fallback => fallback.trim() === '')) {
    throw new Error('oh-dsh-vision: fallbackModels must contain only non-empty model ids')
  }
  const fallbackModels = explicitFallbacks.length > 0
    ? [...explicitFallbacks]
    : baseURL.replace(/\/+$/, '') === DEFAULT_VISION_BASE_URL
      && model === DEFAULT_VISION_MODEL
      ? [...DEFAULT_FREE_FALLBACKS]
      : []
  return {
    apiKey: config.apiKey ?? '',
    apiKeyEnv,
    baseURL: baseURL.replace(/\/+$/, ''),
    fallbackModels,
    maxImageBytes: positiveInteger(config.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES, 'maxImageBytes'),
    maxTokens: positiveInteger(config.maxTokens ?? DEFAULT_MAX_TOKENS, 'maxTokens', 32_768),
    model,
    timeoutMs: positiveInteger(config.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'timeoutMs', MAX_TIMEOUT_MS),
  }
}

function isLocalEndpoint(baseURL: string): boolean {
  const hostname = new URL(baseURL).hostname
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

async function resolveApiKey(ctx: Context, config: ResolvedVisionConfig): Promise<string> {
  if (config.apiKey !== '') return config.apiKey
  const references = [
    config.apiKeyEnv,
    'DSH_VISION_API_KEY',
    'ZHIPUAI_API_KEY',
    'DASHSCOPE_API_KEY',
  ]
  for (const reference of new Set(references)) {
    const resolved = await ctx.credentials.resolve(credentialRef(reference))
    if (resolved !== undefined) return resolved.value
  }
  if (isLocalEndpoint(config.baseURL)) return ''
  throw new Error(
    'view_image: no vision API key is configured. Store VISION_API_KEY in '
    + '$DSH_HOME/.credentials.yaml or export it; alternatively configure '
    + 'oh-dsh-vision.apiKeyEnv in settings.yaml. The default glm-4.6v-flash '
    + 'model is free, and a localhost Ollama endpoint can run without a key.',
  )
}

const VISION_PROMPT = `## Vision (view_image)
The chat model itself cannot see images, but the view_image tool can. When an image matters, call view_image instead of guessing or refusing. It accepts a browser-pasted image reference, a local image path inside the active Session workspace, an HTTP(S) URL, or an image data URL. A pasted image message includes the exact source to pass. Ask a focused question for OCR, object counting, chart reading, screenshot diagnosis, or layout inspection. The configured vision endpoint receives the image and returns text; use a follow-up call when another focused question is needed.`

const DEFAULT_QUESTION = 'Describe this image thoroughly. Include any visible text verbatim, the overall layout, and notable details.'

/** Mount one tool and prompt section shared by every Oh-DSH surface. */
export function apply(ctx: Context, config: Config): void {
  resolveVisionConfig(config)
  let current = (): Config => config
  const surface = ctx.get(OH_DSH_SURFACE_SERVICE) as OhDshSurface | undefined
  const registry = surface?.dataRoot === undefined || surface.dataRoot === ''
    ? undefined
    : new VisionAttachmentRegistry(surface.dataRoot)

  if (registry !== undefined && hasBrowserSurface(surface?.kind)) {
    ctx.inject(['webServer', 'agents'], (scope) => {
      scope.effect(
        () => mountVisionAttachmentServer(
          scope as never,
          registry,
          () => resolveVisionConfig(current()).maxImageBytes,
        ),
        'oh-dsh-vision: pasted image upload',
      )
    })
  }

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'view_image',
    description: 'Ask the configured vision model about an image. Accepts session-bound pasted-image references, workspace-local paths, HTTP(S) URLs, and image data URLs.',
    parameters: {
      source: {
        type: 'string',
        required: true,
        description: 'Pasted-image reference, workspace-local path, HTTP(S) URL, or image data URL',
      },
      question: {
        type: 'string',
        description: 'A specific question about the image; defaults to a thorough description',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    timeoutMs: MAX_TIMEOUT_MS + 5_000,
    isConcurrencySafe: () => true,
    execute: async (args, exec) => {
      const resolved = resolveVisionConfig(current())
      const apiKey = await resolveApiKey(ctx, resolved)
      let source = args.source
      if (source.startsWith(VISION_ATTACHMENT_SCHEME)) {
        if (visionAttachmentToken(source) === undefined) {
          throw new Error('view_image: invalid pasted-image attachment reference')
        }
        const sessionId = exec.agent?.session.id
        if (sessionId === undefined || registry === undefined) {
          throw new Error('view_image: pasted-image attachments require an active Oh-DSH Session')
        }
        const attachment = await registry.resolve(source, String(sessionId))
        if (attachment.bytes > resolved.maxImageBytes) {
          throw new Error(
            `view_image: pasted image is ${String(attachment.bytes)} bytes, over the `
            + `${String(resolved.maxImageBytes)}-byte limit`,
          )
        }
        const attachments = (ctx as unknown as { attachments: VisionAttachmentReader }).attachments
        const stored = await attachments.readImage(attachment, exec.signal)
        source = `data:${stored.ref.mediaType};base64,${Buffer.from(stored.data).toString('base64')}`
      }
      let lastError: unknown
      for (const model of [resolved.model, ...resolved.fallbackModels]) {
        try {
          return await visionChat({
            ...resolved,
            apiKey,
            model,
            question: args.question === undefined || args.question === ''
              ? DEFAULT_QUESTION
              : args.question,
            signal: exec.signal,
            source,
            ...(exec.agent?.session.header.cwd === undefined
              ? {}
              : { workspaceRoot: exec.agent.session.header.cwd }),
          })
        } catch (error) {
          lastError = error
          if (!isRetriableVisionError(error)) throw error
        }
      }
      throw lastError
    },
  })), 'oh-dsh-vision.tool')

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'tool:oh-dsh-vision',
    order: 116,
    text: VISION_PROMPT,
  }), 'oh-dsh-vision.prompt')

  installSettingsSection(ctx, SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => { current = source },
    onChange: () => {},
    validate: (value) => { resolveVisionConfig(value) },
  })
}
