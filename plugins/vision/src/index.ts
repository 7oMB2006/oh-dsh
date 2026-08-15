/** Cross-surface image understanding through an OpenAI-compatible VLM. */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import {
  isRetriableVisionError,
  isVisionBackendError,
  visionChat,
} from './vlm.ts'

export const name = 'oh-dsh-vision'
export const inject = ['attachments', 'credentials', 'llm', 'systemPrompt', 'tools']

export const DEFAULT_VISION_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4'
export const DEFAULT_VISION_MODEL = 'glm-4.6v-flash'
/** Canonical credential name for the default Zhipu Vision endpoint. */
export const DEFAULT_VISION_API_KEY_REF = 'ZHIPUAI_API_KEY'
export const DEFAULT_FREE_FALLBACKS = Object.freeze([
  'glm-4.1v-thinking-flash',
  'glm-4v-flash',
] as const)

const DEFAULT_MAX_TOKENS = 2048
const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024
const DEFAULT_LOCAL_BASE_URL = 'http://localhost:11434/v1'
const DEFAULT_LOCAL_API_KEY_REF = 'LOCAL_VISION_API_KEY'
const DEFAULT_RETRY_ATTEMPTS = 3
const DEFAULT_RETRY_BACKOFF_MS = 1_000
const MAX_TIMEOUT_MS = 300_000
const MAX_RETRY_ATTEMPTS = 5
const MAX_RETRY_BACKOFF_MS = 60_000
const SETTINGS_NAMESPACE = settingsNamespace('oh-dsh-vision')

/** Shared vision configuration for Desktop, Web, and TUI. */
export interface Config {
  apiKey?: string
  apiKeyEnv?: string
  baseURL?: string
  fallbackModels?: string[]
  localApiKey?: string
  localApiKeyEnv?: string
  localBaseURL?: string
  localFallbackModels?: string[]
  localModel?: string
  maxImageBytes?: number
  maxTokens?: number
  model?: string
  retryAttempts?: number
  retryBackoffMs?: number
  timeoutMs?: number
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret').default('')
    .description('Literal API key; prefer apiKeyEnv and the DSH credential store'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_VISION_API_KEY_REF)
    .description('Credential reference resolved for each image request; defaults to ZHIPUAI_API_KEY'),
  baseURL: z.string().default(DEFAULT_VISION_BASE_URL)
    .description('OpenAI-compatible endpoint base URL; /chat/completions is appended'),
  fallbackModels: z.array(z.string()).default([])
    .description('Models tried after a 404, 429, or 5xx response'),
  localApiKey: z.string().role('secret').default('')
    .description('Optional key for the local OpenAI-compatible OCR/VLM endpoint'),
  localApiKeyEnv: z.string().role('credential-ref').default(DEFAULT_LOCAL_API_KEY_REF)
    .description('Credential reference for the local OCR/VLM endpoint'),
  localBaseURL: z.string().default(DEFAULT_LOCAL_BASE_URL)
    .description('Local OpenAI-compatible OCR/VLM endpoint; Ollama defaults to localhost'),
  localFallbackModels: z.array(z.string()).default([])
    .description('Additional local OCR/VLM model ids tried after a transient failure'),
  localModel: z.string().default('')
    .description('Selected local OCR/VLM model id; empty disables the local fallback'),
  maxImageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_IMAGE_BYTES),
  maxTokens: z.number().step(1).min(1).max(32_768).default(DEFAULT_MAX_TOKENS),
  model: z.string().default(DEFAULT_VISION_MODEL),
  retryAttempts: z.number().step(1).min(0).max(MAX_RETRY_ATTEMPTS).default(DEFAULT_RETRY_ATTEMPTS)
    .description('Additional attempts for a rate-limited or transient vision request'),
  retryBackoffMs: z.number().step(1).min(100).max(MAX_RETRY_BACKOFF_MS).default(DEFAULT_RETRY_BACKOFF_MS)
    .description('Initial delay for exponential vision-request retry backoff'),
  timeoutMs: z.number().step(1).min(1_000).max(MAX_TIMEOUT_MS).default(DEFAULT_TIMEOUT_MS),
})

/** Fully validated facts for one image request. */
export interface ResolvedVisionConfig {
  apiKey: string
  apiKeyEnv: string
  baseURL: string
  fallbackModels: string[]
  localApiKey: string
  localApiKeyEnv: string
  localBaseURL: string
  localFallbackModels: string[]
  localModel: string
  maxImageBytes: number
  maxTokens: number
  model: string
  retryAttempts: number
  retryBackoffMs: number
  timeoutMs: number
}

function positiveInteger(value: number, name: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`oh-dsh-vision: ${name} must be a positive integer no greater than ${maximum}`)
  }
  return value
}

function nonNegativeInteger(value: number, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`oh-dsh-vision: ${name} must be an integer from 0 to ${maximum}`)
  }
  return value
}

function normalizeBaseURL(value: string, name: string): string {
  let endpoint: URL
  try {
    endpoint = new URL(value)
  } catch {
    throw new Error(`oh-dsh-vision: invalid ${name} ${JSON.stringify(value)}`)
  }
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
    throw new Error(`oh-dsh-vision: ${name} must use http or https`)
  }
  return value.replace(/\/+$/, '')
}

function modelList(
  primary: string,
  fallbacks: string[] | undefined,
  name: string,
): string[] {
  if (primary.trim() === '') throw new Error(`oh-dsh-vision: ${name} must be non-empty`)
  const explicitFallbacks = fallbacks ?? []
  if (explicitFallbacks.some(fallback => fallback.trim() === '')) {
    throw new Error(`oh-dsh-vision: ${name} fallbacks must contain only non-empty model ids`)
  }
  return [primary, ...explicitFallbacks]
}

/** Resolve schema defaults and re-judge programmatic configuration. */
export function resolveVisionConfig(config: Config): ResolvedVisionConfig {
  const baseURL = normalizeBaseURL(config.baseURL ?? DEFAULT_VISION_BASE_URL, 'baseURL')
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
  const localModel = config.localModel ?? ''
  const localBaseURL = normalizeBaseURL(config.localBaseURL ?? DEFAULT_LOCAL_BASE_URL, 'localBaseURL')
  const localApiKeyEnv = config.localApiKeyEnv ?? DEFAULT_LOCAL_API_KEY_REF
  credentialRef(localApiKeyEnv)
  const localFallbackModels = config.localFallbackModels ?? []
  if (localFallbackModels.some(fallback => fallback.trim() === '')) {
    throw new Error('oh-dsh-vision: localFallbackModels must contain only non-empty model ids')
  }
  if (localModel.trim() !== '') modelList(localModel, localFallbackModels, 'localModel')
  return {
    apiKey: config.apiKey ?? '',
    apiKeyEnv,
    baseURL,
    fallbackModels,
    localApiKey: config.localApiKey ?? '',
    localApiKeyEnv,
    localBaseURL,
    localFallbackModels,
    localModel,
    maxImageBytes: positiveInteger(config.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES, 'maxImageBytes'),
    maxTokens: positiveInteger(config.maxTokens ?? DEFAULT_MAX_TOKENS, 'maxTokens', 32_768),
    model,
    retryAttempts: nonNegativeInteger(
      config.retryAttempts ?? DEFAULT_RETRY_ATTEMPTS,
      'retryAttempts',
      MAX_RETRY_ATTEMPTS,
    ),
    retryBackoffMs: positiveInteger(
      config.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS,
      'retryBackoffMs',
      MAX_RETRY_BACKOFF_MS,
    ),
    timeoutMs: positiveInteger(config.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'timeoutMs', MAX_TIMEOUT_MS),
  }
}

function isLocalEndpoint(baseURL: string): boolean {
  const hostname = new URL(baseURL).hostname
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

interface VisionBackend {
  apiKey: string
  apiKeyEnv: string
  baseURL: string
  fallbackModels: string[]
  kind: 'cloud' | 'local'
  model: string
}

interface VisionModelInfo {
  provider: string
  id: string
  inputModalities?: readonly string[]
  [key: string]: unknown
}

interface VisionAttachment {
  attachmentId: string
  mediaType: string
  bytes?: number
  name?: string
}

interface StoredVisionAttachment {
  ref: VisionAttachment
  data: Uint8Array
}

interface VisionAttachmentStore {
  readImage(ref: VisionAttachment, signal?: AbortSignal): Promise<StoredVisionAttachment>
}

interface VisionContent {
  type: string
  attachment?: VisionAttachment
  content?: readonly VisionContent[]
  [key: string]: unknown
}

interface VisionMessage {
  content: readonly VisionContent[]
  [key: string]: unknown
}

interface VisionStreamOptions {
  provider: string
  model: string
  messages: readonly VisionMessage[]
  signal?: AbortSignal
  [key: string]: unknown
}

interface VisionLlm {
  resolveModelInfo(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<VisionModelInfo>
  stream(options: VisionStreamOptions): AsyncIterable<unknown>
}

function cloudBackend(config: ResolvedVisionConfig): VisionBackend {
  return {
    apiKey: config.apiKey,
    apiKeyEnv: config.apiKeyEnv,
    baseURL: config.baseURL,
    fallbackModels: config.fallbackModels,
    kind: 'cloud',
    model: config.model,
  }
}

function localBackend(config: ResolvedVisionConfig): VisionBackend | undefined {
  if (config.localModel.trim() === '') return undefined
  return {
    apiKey: config.localApiKey,
    apiKeyEnv: config.localApiKeyEnv,
    baseURL: config.localBaseURL,
    fallbackModels: config.localFallbackModels,
    kind: 'local',
    model: config.localModel,
  }
}

async function resolveApiKey(
  ctx: Context,
  backend: VisionBackend,
  options: { cloud?: boolean } = {},
): Promise<string | undefined> {
  if (backend.apiKey !== '') return backend.apiKey
  const references = options.cloud === true
    ? [
      backend.apiKeyEnv,
      'ZHIPUAI_API_KEY',
      'DSH_VISION_API_KEY',
      // Keep the first release's name as a migration fallback. New installs
      // use the provider's canonical key above so the settings card does not
      // create a second copy of the same Zhipu credential.
      'VISION_API_KEY',
      'DASHSCOPE_API_KEY',
    ]
    : [backend.apiKeyEnv, 'DSH_LOCAL_VISION_API_KEY']
  for (const reference of new Set(references)) {
    const resolved = await ctx.credentials.resolve(credentialRef(reference))
    if (resolved !== undefined) return resolved.value
  }
  if (isLocalEndpoint(backend.baseURL)) return ''
  return undefined
}

function noBackendMessage(config: ResolvedVisionConfig): string {
  const localHint = config.localModel.trim() === ''
    ? ' Set oh-dsh-vision.localModel to a locally installed OCR/VLM model '
      + '(for example an Ollama model) to enable local fallback.'
    : ''
  return 'view_image: no usable vision backend is configured. Store ZHIPUAI_API_KEY '
    + 'in $DSH_HOME/.credentials.yaml (legacy VISION_API_KEY is also accepted) '
    + 'or export it, or configure '
    + 'oh-dsh-vision.apiKeyEnv in settings.yaml.'
    + localHint
}

function backendFailureMessage(
  cloudError: unknown,
  localError: unknown,
  config: ResolvedVisionConfig,
): string {
  const detail = (error: unknown): string => error instanceof Error ? error.message : String(error)
  const local = localError === undefined
    ? config.localModel.trim() === ''
      ? 'local OCR fallback is not configured'
      : 'local OCR fallback was unavailable'
    : `local OCR fallback failed: ${detail(localError)}`
  return `view_image: cloud vision failed after retries: ${detail(cloudError)}; ${local}. `
    + 'Check the cloud API key or endpoint, install/configure an OpenAI-compatible '
    + 'local OCR/VLM model, or select a model that supports native image input.'
}

/** DeepSeek V4 is image-capable even though the pinned adapter advertises text-only. */
function isDeepSeekV4Model(provider: string, model: string): boolean {
  return /deepseek[-_]?v4/i.test(`${provider}/${model}`)
}

/**
 * Keep DSH's native attachment rail and submission path intact. The pinned
 * host performs its final image admission check through `resolveModelInfo`;
 * expose the V4 capability there without replacing the input UI or adapter.
 */
function installDeepSeekV4ImageAdmission(ctx: Context): void {
  const llm = (ctx as unknown as { llm?: VisionLlm }).llm
  if (llm === undefined || typeof llm.resolveModelInfo !== 'function') return
  const original = llm.resolveModelInfo
  const wrapped = async function resolveModelInfoWithVision(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<VisionModelInfo> {
    const info = await original.call(llm, provider, model, signal)
    if (!isDeepSeekV4Model(provider, model)
      || info.inputModalities === undefined
      || info.inputModalities.includes('image')) return info
    return { ...info, inputModalities: [...info.inputModalities, 'image'] }
  }
  ctx.effect(() => {
    llm.resolveModelInfo = wrapped
    return () => {
      if (llm.resolveModelInfo === wrapped) llm.resolveModelInfo = original
    }
  }, 'oh-dsh-vision: native DeepSeek V4 image admission')
}

function hasImageContent(blocks: readonly VisionContent[]): boolean {
  return blocks.some(block => block.type === 'image'
    || block.content !== undefined && hasImageContent(block.content))
}

function attachmentDataUrl(ref: VisionAttachment, data: Uint8Array): string {
  return `data:${ref.mediaType};base64,${Buffer.from(data).toString('base64')}`
}

function descriptionCacheKey(ref: VisionAttachment, config: ResolvedVisionConfig): string {
  return [
    ref.attachmentId,
    config.baseURL,
    config.model,
    config.localBaseURL,
    config.localModel,
  ].join('|')
}

/**
 * Adapt native image blocks only for DeepSeek V4's text-only wire adapter.
 * The DSH composer, durable attachment references, and model turn remain
 * unchanged; this host-side proxy supplies a textual image description to
 * the adapter that otherwise rejects image blocks during serialization.
 */
function installDeepSeekV4ImagePreprocessor(
  ctx: Context,
  getConfig: () => Config,
): void {
  const llm = (ctx as unknown as { llm?: VisionLlm }).llm
  const attachments = (ctx as unknown as { attachments?: VisionAttachmentStore }).attachments
  if (llm === undefined || typeof llm.stream !== 'function' || attachments === undefined) return

  const descriptions = new Map<string, Promise<string>>()
  const describe = async (
    ref: VisionAttachment,
    signal: AbortSignal,
  ): Promise<string> => {
    const config = resolveVisionConfig(getConfig())
    const key = descriptionCacheKey(ref, config)
    const cached = descriptions.get(key)
    if (cached !== undefined) return cached
    const pending = (async (): Promise<string> => {
      const stored = await attachments.readImage(ref, signal)
      return await visionWithFallbacks(ctx, config, {
        question: 'Describe this attached image for a text-only model. Include visible text verbatim and all details needed to answer the user. Do not mention this preprocessing step.',
        signal,
        source: attachmentDataUrl(stored.ref, stored.data),
      })
    })()
    descriptions.set(key, pending)
    try {
      return await pending
    } catch (error) {
      descriptions.delete(key)
      throw error
    }
  }

  const rewriteContent = async (
    blocks: readonly VisionContent[],
    signal: AbortSignal,
  ): Promise<VisionContent[]> => {
    const rewritten: VisionContent[] = []
    for (const block of blocks) {
      if (block.type === 'image') {
        if (block.attachment === undefined) {
          throw new Error('oh-dsh-vision: native image content is missing its attachment reference')
        }
        const description = await describe(block.attachment, signal)
        const label = block.attachment.name === undefined
          ? 'Attached image'
          : `Attached image (${block.attachment.name})`
        rewritten.push({
          type: 'text',
          text: `[${label} description]\n${description}`,
        })
        continue
      }
      if (block.content !== undefined) {
        rewritten.push({
          ...block,
          content: await rewriteContent(block.content, signal),
        })
      } else {
        rewritten.push(block)
      }
    }
    return rewritten
  }

  ctx.on('llm/stream', (options: VisionStreamOptions, next) => {
    if (!isDeepSeekV4Model(options.provider, options.model)
      || !options.messages.some(message => hasImageContent(message.content))) {
      return next()
    }

    return (async function* (): AsyncIterable<unknown> {
      const signal = options.signal ?? new AbortController().signal
      const messages: VisionMessage[] = []
      for (const message of options.messages) {
        messages.push({
          ...message,
          content: await rewriteContent(message.content, signal),
        })
      }
      // Re-enter the normal DSH waterfall with a detached, text-only request.
      // The original native attachment references remain the durable source of
      // truth; only this adapter-facing call sees the descriptions.
      yield* llm.stream({ ...options, messages })
    })()
  }, { global: true })
}

const VISION_PROMPT = `## Vision (view_image)
Use DSH's native image attachment input whenever the selected model accepts images; the Desktop/Web input bar owns the thumbnail rail, paste handling, and submission. DeepSeek V4 is admitted through the built-in vision plugin even though the pinned chat adapter is text-only: the Host describes native attachments through the configured vision backend and sends that description through the same V4 turn. No second composer, upload endpoint, or attachment protocol is used. Use view_image for an explicit local image path inside the active Session workspace, an HTTP(S) URL, or an image data URL when a separate vision question is needed. Ask a focused question for OCR, object counting, chart reading, screenshot diagnosis, or layout inspection. Cloud vision is attempted first; after transient failures the configured local OCR/VLM model is tried, then the cloud backend gets a bounded recovery attempt. If every backend fails, explain that the user should check the cloud key or install/configure a local OCR model.`

const DEFAULT_QUESTION = 'Describe this image thoroughly. Include any visible text verbatim, the overall layout, and notable details.'

interface VisionAttemptResult {
  available: boolean
  error?: unknown
  value?: string
}

async function attemptBackend(
  ctx: Context,
  backend: VisionBackend,
  config: ResolvedVisionConfig,
  request: {
    question: string
    signal: AbortSignal
    source: string
    workspaceRoot?: string
  },
  retryAttempts: number,
): Promise<VisionAttemptResult> {
  let apiKey: string | undefined
  try {
    apiKey = await resolveApiKey(ctx, backend, { cloud: backend.kind === 'cloud' })
  } catch (error) {
    return { available: false, error }
  }
  if (apiKey === undefined) {
    return {
      available: false,
      error: new Error(
        `no API key is configured for ${backend.baseURL} (${backend.model})`,
      ),
    }
  }

  let lastError: unknown
  for (const model of [backend.model, ...backend.fallbackModels]) {
    try {
      return {
        available: true,
        value: await visionChat({
          ...config,
          apiKey,
          baseURL: backend.baseURL,
          model,
          retryAttempts,
          question: request.question,
          signal: request.signal,
          source: request.source,
          workspaceRoot: request.workspaceRoot,
        }),
      }
    } catch (error) {
      if (!isVisionBackendError(error)) throw error
      lastError = error
      if (!isRetriableVisionError(error)) break
    }
  }
  return { available: true, error: lastError }
}

async function visionWithFallbacks(
  ctx: Context,
  config: ResolvedVisionConfig,
  request: {
    question: string
    signal: AbortSignal
    source: string
    workspaceRoot?: string
  },
): Promise<string> {
  const cloud = cloudBackend(config)
  const primary = await attemptBackend(ctx, cloud, config, request, config.retryAttempts)
  if (primary.value !== undefined) return primary.value

  const local = localBackend(config)
  let localAttempt: VisionAttemptResult | undefined
  if (local !== undefined) {
    localAttempt = await attemptBackend(ctx, local, config, request, config.retryAttempts)
    if (localAttempt.value !== undefined) return localAttempt.value
  }

  // A temporary cloud outage may recover while a local OCR model is being
  // selected or after it has returned an incompatible response. One final
  // no-backoff pass keeps the total request count bounded and preserves the
  // cloud-key-first policy without looping forever on a bad credential.
  if (primary.available) {
    const recovery = await attemptBackend(ctx, cloud, config, request, 0)
    if (recovery.value !== undefined) return recovery.value
    throw new Error(backendFailureMessage(primary.error, localAttempt?.error, config))
  }
  if (localAttempt?.available === true) {
    throw new Error(backendFailureMessage(primary.error, localAttempt.error, config))
  }
  throw new Error(noBackendMessage(config))
}

/** Mount one tool and prompt section shared by every Oh-DSH surface. */
export function apply(ctx: Context, config: Config): void {
  resolveVisionConfig(config)
  let current = (): Config => config
  installDeepSeekV4ImageAdmission(ctx)
  installDeepSeekV4ImagePreprocessor(ctx, current)

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'view_image',
    description: 'Ask the configured vision model about an image. Accepts workspace-local paths, HTTP(S) URLs, and image data URLs.',
    parameters: {
      source: {
        type: 'string',
        required: true,
        description: 'Workspace-local path, HTTP(S) URL, or image data URL',
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
      return await visionWithFallbacks(ctx, resolved, {
        question: args.question === undefined || args.question === ''
          ? DEFAULT_QUESTION
          : args.question,
        signal: exec.signal,
        source: args.source,
        ...(exec.agent?.session.header.cwd === undefined
          ? {}
          : { workspaceRoot: exec.agent.session.header.cwd }),
      })
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
