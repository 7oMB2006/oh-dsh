/** Native Plugins settings card for the built-in Vision host plugin. */

import type { ConnectionHandle, IApiClient } from '@deepseek-ai/dsh-client-connection/client'
import type {
  ClientContext, SettingsScope, SettingsScopeSnapshot, SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// These imports contribute only Cordis/client type merges. Runtime
// collaboration remains through the native settings, locale, connection, and
// slot services provided by DSH.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { useState, type CSSProperties } from 'react'

export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

const SETTINGS_NAMESPACE = 'oh-dsh-vision'
const DEFAULT_CLOUD_KEY_REF = 'VISION_API_KEY'
const DEFAULT_LOCAL_KEY_REF = 'LOCAL_VISION_API_KEY'

/** Settings that are safe to edit through the redacted native settings API. */
interface VisionSettings {
  apiKeyEnv?: string
  baseURL?: string
  fallbackModels?: string[]
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

type VisionFieldName = keyof VisionSettings

type VisionLocaleKey =
  | 'title' | 'description' | 'apiKey' | 'apiKeyHint' | 'apiKeySet' | 'apiKeyUnset'
  | 'apiKeyEnv' | 'apiKeyEnvHint' | 'baseURL' | 'baseURLHint' | 'model' | 'modelHint'
  | 'fallbackModels' | 'fallbackModelsHint' | 'maxTokens' | 'maxTokensHint'
  | 'timeoutMs' | 'timeoutMsHint' | 'maxImageBytes' | 'maxImageBytesHint'
  | 'retryAttempts' | 'retryAttemptsHint' | 'retryBackoffMs' | 'retryBackoffMsHint'
  | 'localApiKey' | 'localApiKeyHint' | 'localApiKeySet' | 'localApiKeyUnset'
  | 'localApiKeyEnv' | 'localApiKeyEnvHint' | 'localBaseURL' | 'localBaseURLHint'
  | 'localModel' | 'localModelHint' | 'localFallbackModels' | 'localFallbackModelsHint'
  | 'overridden' | 'reset' | 'readOnly' | 'expand' | 'collapse' | 'save' | 'saving'
  | 'discard' | 'unsaved' | 'saveFailed' | 'invalidValue'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'oh-dsh-vision': VisionLocaleKey
  }
}

interface FieldWrite {
  kind: 'set' | 'clear'
  value?: unknown
}

interface FieldSpec {
  format(value: unknown): string
  parse(text: string): FieldWrite | undefined
}

interface CardFieldState {
  text: string
  overridden: boolean
  invalid: boolean
}

interface CardState {
  available: boolean
  writable: boolean
  dirty: boolean
  invalid: boolean
  saving: boolean
  failed: boolean
  fields: Record<VisionFieldName, CardFieldState>
  cloudKeyConfigured: boolean
  cloudKeyWritable: boolean
  localKeyConfigured: boolean
  localKeyWritable: boolean
}

interface CardFace {
  hooks: { visionCard: SnapshotStore<CardState> }
  edit(field: string, text: string): void
  resetField(field: string): void
  save(): void
  discard(): void
}

interface StagedEdit {
  text: string
  clear: boolean
}

interface PlannedWrite {
  run: (() => Promise<boolean>) | undefined
}

const FIELD_ORDER: readonly VisionFieldName[] = [
  'apiKeyEnv',
  'baseURL',
  'model',
  'fallbackModels',
  'maxTokens',
  'timeoutMs',
  'maxImageBytes',
  'retryAttempts',
  'retryBackoffMs',
  'localApiKeyEnv',
  'localBaseURL',
  'localModel',
  'localFallbackModels',
]

function textSpec(): FieldSpec {
  return {
    format: value => typeof value === 'string' ? value : '',
    parse: text => text.trim() === ''
      ? { kind: 'clear' }
      : { kind: 'set', value: text.trim() },
  }
}

function listSpec(): FieldSpec {
  return {
    format: value => Array.isArray(value) ? value.join(', ') : '',
    parse: (text) => {
      const values = text.split(/[\n,]/u).map(item => item.trim()).filter(Boolean)
      return values.length === 0 ? { kind: 'clear' } : { kind: 'set', value: values }
    },
  }
}

function integerSpec(minimum: number): FieldSpec {
  return {
    format: value => typeof value === 'number' ? String(value) : '',
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      const value = Number(trimmed)
      if (!Number.isSafeInteger(value) || value < minimum) return undefined
      return { kind: 'set', value }
    },
  }
}

const FIELD_SPECS: Record<VisionFieldName, FieldSpec> = {
  apiKeyEnv: textSpec(),
  baseURL: textSpec(),
  fallbackModels: listSpec(),
  localApiKeyEnv: textSpec(),
  localBaseURL: textSpec(),
  localFallbackModels: listSpec(),
  localModel: textSpec(),
  maxImageBytes: integerSpec(1),
  maxTokens: integerSpec(1),
  model: textSpec(),
  retryAttempts: integerSpec(0),
  retryBackoffMs: integerSpec(100),
  timeoutMs: integerSpec(1_000),
}

function snapshotValue(snapshot: SettingsScopeSnapshot<VisionSettings>, field: VisionFieldName): unknown {
  return (snapshot.value as Record<string, unknown> | undefined)?.[field]
}

function baseValue(snapshot: SettingsScopeSnapshot<VisionSettings>, field: VisionFieldName): unknown {
  return (snapshot.base as Record<string, unknown> | undefined)?.[field]
}

function hasUserValue(snapshot: SettingsScopeSnapshot<VisionSettings>, field: VisionFieldName): boolean {
  const user = snapshot.user as Record<string, unknown> | undefined
  return user !== undefined && Object.hasOwn(user, field)
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function credentialRef(
  snapshot: SettingsScopeSnapshot<VisionSettings>,
  field: 'apiKeyEnv' | 'localApiKeyEnv',
  fallback: string,
): string {
  const value = snapshotValue(snapshot, field)
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
}

interface CredentialState {
  ref: string
  configured: boolean
  writable: boolean
}

class VisionCardController {
  private readonly staged = new Map<string, StagedEdit>()
  private readonly store: SnapshotStore<CardState>
  private cloudCredential: CredentialState = {
    ref: '', configured: false, writable: true,
  }
  private localCredential: CredentialState = {
    ref: '', configured: false, writable: true,
  }
  private saving = false
  private failed = false

  constructor(
    private readonly scope: SettingsScope<VisionSettings>,
    private readonly api: Pick<IApiClient, 'credentials'>,
  ) {
    this.store = createSnapshotStore(this.project())
    scope.subscribe(() => {
      this.publish()
      void this.refreshCredentials()
    })
    void this.refreshCredentials()
  }

  inject(): CardFace {
    return {
      hooks: { visionCard: this.store },
      edit: (field, text) => { this.edit(field, text) },
      resetField: field => { this.resetField(field) },
      save: () => { void this.save() },
      discard: () => { this.discard() },
    }
  }

  refreshCredential(ref: string): void {
    const snapshot = this.scope.getSnapshot()
    const cloudRef = credentialRef(snapshot, 'apiKeyEnv', DEFAULT_CLOUD_KEY_REF)
    const localRef = credentialRef(snapshot, 'localApiKeyEnv', DEFAULT_LOCAL_KEY_REF)
    if (ref === cloudRef || ref === localRef) void this.refreshCredentials()
  }

  private project(): CardState {
    const snapshot = this.scope.getSnapshot()
    const fields = {} as Record<VisionFieldName, CardFieldState>
    let invalid = false
    for (const field of FIELD_ORDER) {
      const staged = this.staged.get(field)
      const spec = FIELD_SPECS[field]
      if (staged === undefined) {
        fields[field] = {
          text: spec.format(snapshotValue(snapshot, field)),
          overridden: hasUserValue(snapshot, field),
          invalid: false,
        }
        continue
      }
      const write = staged.clear ? { kind: 'clear' as const } : spec.parse(staged.text)
      fields[field] = {
        text: staged.text,
        overridden: write?.kind === 'set',
        invalid: write === undefined,
      }
      invalid = invalid || write === undefined
    }
    const plan = this.plan()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: plan.length > 0,
      invalid,
      saving: this.saving,
      failed: this.failed,
      fields,
      cloudKeyConfigured: this.cloudCredential.configured,
      cloudKeyWritable: this.cloudCredential.writable,
      localKeyConfigured: this.localCredential.configured,
      localKeyWritable: this.localCredential.writable,
    }
  }

  private edit(field: string, text: string): void {
    if (field !== 'cloudApiKey' && field !== 'localApiKey' && !(field in FIELD_SPECS)) return
    this.staged.set(field, { text, clear: false })
    this.failed = false
    this.publish()
  }

  private resetField(field: string): void {
    if (!(field in FIELD_SPECS)) return
    const name = field as VisionFieldName
    const snapshot = this.scope.getSnapshot()
    this.staged.set(field, {
      text: FIELD_SPECS[name].format(baseValue(snapshot, name)),
      clear: true,
    })
    this.failed = false
    this.publish()
  }

  private discard(): void {
    this.staged.clear()
    this.failed = false
    this.publish()
  }

  private plan(): PlannedWrite[] {
    const snapshot = this.scope.getSnapshot()
    const writes: PlannedWrite[] = []
    for (const [field, staged] of this.staged) {
      if (field === 'cloudApiKey' || field === 'localApiKey') {
        if (staged.text.trim() !== '') {
          writes.push({ run: () => this.writeCredential(field, staged.text.trim()) })
        }
        continue
      }
      const name = field as VisionFieldName
      const spec = FIELD_SPECS[name]
      if (staged.clear) {
        if (hasUserValue(snapshot, name)) writes.push({ run: () => this.clear(name) })
        continue
      }
      const write = spec.parse(staged.text)
      if (write === undefined) {
        writes.push({ run: undefined })
        continue
      }
      if (write.kind === 'clear') {
        if (hasUserValue(snapshot, name)) writes.push({ run: () => this.clear(name) })
      } else if (!hasUserValue(snapshot, name) || !sameValue(snapshotValue(snapshot, name), write.value)) {
        writes.push({ run: () => this.storeValue(name, write.value) })
      }
    }
    return writes
  }

  private async save(): Promise<void> {
    const plan = this.plan()
    if (plan.length === 0 || plan.some(item => item.run === undefined) || this.saving) return
    this.saving = true
    this.failed = false
    this.publish()
    let landed = true
    for (const write of plan) landed = await write.run!() && landed
    if (landed) this.staged.clear()
    this.saving = false
    this.failed = !landed
    this.publish()
  }

  private async storeValue(field: VisionFieldName, value: unknown): Promise<boolean> {
    await this.scope.set(field, value)
    const snapshot = this.scope.getSnapshot()
    return hasUserValue(snapshot, field) && sameValue(snapshotValue(snapshot, field), value)
  }

  private async clear(field: VisionFieldName): Promise<boolean> {
    await this.scope.unset(field)
    return !hasUserValue(this.scope.getSnapshot(), field)
  }

  private async writeCredential(field: string, value: string): Promise<boolean> {
    const snapshot = this.scope.getSnapshot()
    const ref = field === 'cloudApiKey'
      ? credentialRef(snapshot, 'apiKeyEnv', DEFAULT_CLOUD_KEY_REF)
      : credentialRef(snapshot, 'localApiKeyEnv', DEFAULT_LOCAL_KEY_REF)
    try {
      const response = await this.api.credentials.set({ ref, value })
      if (!response.result.ok) return false
    } catch {
      return false
    }
    await this.refreshCredentials()
    return field === 'cloudApiKey'
      ? this.cloudCredential.configured
      : this.localCredential.configured
  }

  private async refreshCredentials(): Promise<void> {
    const snapshot = this.scope.getSnapshot()
    const cloudRef = credentialRef(snapshot, 'apiKeyEnv', DEFAULT_CLOUD_KEY_REF)
    const localRef = credentialRef(snapshot, 'localApiKeyEnv', DEFAULT_LOCAL_KEY_REF)
    this.cloudCredential = { ...this.cloudCredential, ref: cloudRef, configured: false }
    this.localCredential = { ...this.localCredential, ref: localRef, configured: false }
    this.publish()
    try {
      const response = await this.api.credentials.describe({ refs: [cloudRef, localRef] })
      if (!response.result.ok) return
      const current = this.scope.getSnapshot()
      if (credentialRef(current, 'apiKeyEnv', DEFAULT_CLOUD_KEY_REF) !== cloudRef
        || credentialRef(current, 'localApiKeyEnv', DEFAULT_LOCAL_KEY_REF) !== localRef) return
      const cloud = response.result.value.credentials[cloudRef]
      const local = response.result.value.credentials[localRef]
      this.cloudCredential = {
        ref: cloudRef,
        configured: cloud?.configured ?? false,
        writable: cloud?.writable ?? true,
      }
      this.localCredential = {
        ref: localRef,
        configured: local?.configured ?? false,
        writable: local?.writable ?? true,
      }
      this.publish()
    } catch {
      // The card remains usable when the credentials transport is unavailable.
    }
  }

  private publish(): void {
    this.store.set(this.project())
  }
}

const en: Record<VisionLocaleKey, string> = {
  title: 'Vision',
  description: 'Describes native image attachments for text-only models.',
  apiKey: 'Cloud API key',
  apiKeyHint: 'Stored in the DSH credential store. Leave blank to keep the current key.',
  apiKeySet: 'Configured',
  apiKeyUnset: 'Not configured',
  apiKeyEnv: 'Cloud credential reference',
  apiKeyEnvHint: 'The credential name resolved before each cloud vision request.',
  baseURL: 'Cloud endpoint',
  baseURLHint: 'OpenAI-compatible vision endpoint; /chat/completions is appended.',
  model: 'Cloud model',
  modelHint: 'Primary cloud multimodal model.',
  fallbackModels: 'Cloud fallback models',
  fallbackModelsHint: 'Comma-separated models tried after transient cloud failures.',
  maxTokens: 'Maximum description tokens',
  maxTokensHint: 'Upper bound for each image description.',
  timeoutMs: 'Request timeout (ms)',
  timeoutMsHint: 'How long one vision request may run.',
  maxImageBytes: 'Maximum image bytes',
  maxImageBytesHint: 'Images larger than this are rejected before preprocessing.',
  retryAttempts: 'Retry attempts',
  retryAttemptsHint: 'Additional attempts for rate limits and transient failures.',
  retryBackoffMs: 'Retry backoff (ms)',
  retryBackoffMsHint: 'Initial delay for exponential retry backoff.',
  localApiKey: 'Local OCR/VLM API key',
  localApiKeyHint: 'Optional key for a local OpenAI-compatible endpoint.',
  localApiKeySet: 'Configured',
  localApiKeyUnset: 'Not configured',
  localApiKeyEnv: 'Local credential reference',
  localApiKeyEnvHint: 'Credential name used by the local OCR/VLM fallback.',
  localBaseURL: 'Local OCR/VLM endpoint',
  localBaseURLHint: 'For example, an Ollama OpenAI-compatible endpoint.',
  localModel: 'Local OCR/VLM model',
  localModelHint: 'Empty disables local fallback; enter an installed model id to enable it.',
  localFallbackModels: 'Local fallback models',
  localFallbackModelsHint: 'Comma-separated local model ids tried after transient failures.',
  overridden: 'Overridden',
  reset: 'Reset to default',
  readOnly: 'This deployment stores settings read-only.',
  expand: 'Show settings',
  collapse: 'Hide settings',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard',
  unsaved: 'Unsaved',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  invalidValue: 'Enter a valid value, or leave blank to use the default.',
}

const zh: Record<VisionLocaleKey, string> = {
  title: 'Vision',
  description: '为文本模型描述 DSH 原生图片附件。',
  apiKey: '云端 API Key',
  apiKeyHint: '保存到 DSH 凭据存储。留空表示保留当前密钥。',
  apiKeySet: '已配置',
  apiKeyUnset: '未配置',
  apiKeyEnv: '云端凭据引用',
  apiKeyEnvHint: '每次调用云端 Vision 前解析的凭据名称。',
  baseURL: '云端接口地址',
  baseURLHint: '兼容 OpenAI 的 Vision 接口，会自动追加 /chat/completions。',
  model: '云端模型',
  modelHint: '首选云端多模态模型。',
  fallbackModels: '云端备用模型',
  fallbackModelsHint: '用逗号分隔，在云端临时失败后依次尝试。',
  maxTokens: '描述最大 Token 数',
  maxTokensHint: '每张图片描述允许生成的最大 Token 数。',
  timeoutMs: '请求超时（毫秒）',
  timeoutMsHint: '单次 Vision 请求最多运行多久。',
  maxImageBytes: '图片最大字节数',
  maxImageBytesHint: '超过此大小的图片会在预处理前被拒绝。',
  retryAttempts: '重试次数',
  retryAttemptsHint: '遇到限流或临时错误时的额外尝试次数。',
  retryBackoffMs: '重试退避（毫秒）',
  retryBackoffMsHint: '指数退避的初始等待时间。',
  localApiKey: '本地 OCR/VLM API Key',
  localApiKeyHint: '可选，用于本地兼容 OpenAI 的 OCR/VLM 接口。',
  localApiKeySet: '已配置',
  localApiKeyUnset: '未配置',
  localApiKeyEnv: '本地凭据引用',
  localApiKeyEnvHint: '本地 OCR/VLM fallback 使用的凭据名称。',
  localBaseURL: '本地 OCR/VLM 接口地址',
  localBaseURLHint: '例如 Ollama 的 OpenAI 兼容接口地址。',
  localModel: '本地 OCR/VLM 模型',
  localModelHint: '留空表示禁用本地 fallback；填写已安装的模型 ID 可启用。',
  localFallbackModels: '本地备用模型',
  localFallbackModelsHint: '用逗号分隔，在本地临时失败后依次尝试。',
  overridden: '已覆盖',
  reset: '恢复默认',
  readOnly: '本部署的设置为只读。',
  expand: '展开设置',
  collapse: '收起设置',
  save: '保存',
  saving: '保存中…',
  discard: '放弃修改',
  unsaved: '未保存',
  saveFailed: '本部署没有接受这些值，已保留供你修改。',
  invalidValue: '请输入有效值；留空表示使用默认值。',
}

const cardStyle: CSSProperties = {
  listStyle: 'none',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 12,
  background: 'var(--dsw-alias-bg-layer-3)',
  overflow: 'hidden',
}

const inputStyle: CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  height: 34,
  padding: '0 12px',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-layer-3)',
  color: 'var(--dsw-alias-label-primary)',
  font: 'inherit',
  fontSize: 13,
}

function Field(props: {
  id: string
  label: string
  hint: string
  state: CardFieldState
  disabled: boolean
  onEdit(text: string): void
  onReset(): void
  t: (key: VisionLocaleKey) => string
  numeric?: boolean
}) {
  const { state } = props
  return (
    <div style={{ padding: '12px 0', borderTop: '1px solid var(--dsw-alias-border-l2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <label htmlFor={props.id} style={{ flex: 1, color: 'var(--dsw-alias-label-primary)', fontSize: 13, fontWeight: 500 }}>
          {props.label}
        </label>
        {state.overridden ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--dsw-alias-label-secondary)', fontSize: 11 }}>
            <span>{props.t('overridden')}</span>
            <button type="button" style={linkButtonStyle} disabled={props.disabled} onClick={props.onReset}>
              {props.t('reset')}
            </button>
          </span>
        ) : null}
      </div>
      <input
        id={props.id}
        type="text"
        inputMode={props.numeric === true ? 'numeric' : undefined}
        value={state.text}
        disabled={props.disabled}
        aria-invalid={state.invalid || undefined}
        style={state.invalid ? { ...inputStyle, borderColor: 'var(--dsw-alias-label-error)' } : inputStyle}
        onChange={event => { props.onEdit(event.target.value) }}
      />
      <p style={{ margin: '6px 0 0', color: state.invalid ? 'var(--dsw-alias-label-error)' : 'var(--dsw-alias-label-tertiary)', fontSize: 12, lineHeight: 1.5 }}>
        {state.invalid ? props.t('invalidValue') : props.hint}
      </p>
    </div>
  )
}

function SecretField(props: {
  id: string
  label: string
  hint: string
  text: string
  configured: boolean
  disabled: boolean
  stateLabel: string
  onEdit(text: string): void
}) {
  return (
    <div style={{ padding: '12px 0', borderTop: '1px solid var(--dsw-alias-border-l2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <label htmlFor={props.id} style={{ flex: 1, color: 'var(--dsw-alias-label-primary)', fontSize: 13, fontWeight: 500 }}>
          {props.label}
        </label>
        <span style={{ color: props.configured ? 'var(--dsw-alias-label-secondary)' : 'var(--dsw-alias-label-tertiary)', fontSize: 11 }}>
          {props.stateLabel}
        </span>
      </div>
      <input
        id={props.id}
        type="password"
        autoComplete="off"
        value={props.text}
        disabled={props.disabled}
        style={inputStyle}
        onChange={event => { props.onEdit(event.target.value) }}
      />
      <p style={{ margin: '6px 0 0', color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, lineHeight: 1.5 }}>
        {props.hint}
      </p>
    </div>
  )
}

const linkButtonStyle: CSSProperties = {
  border: 0,
  padding: 0,
  background: 'none',
  color: 'var(--dsw-alias-label-secondary)',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 12,
}

const footerButtonStyle: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 8,
  padding: '5px 14px',
  background: 'none',
  color: 'var(--dsw-alias-label-secondary)',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 13,
}

type VisionCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'oh-dsh-vision'>
  & InjectFace<CardFace>

function VisionCard(props: VisionCardProps) {
  const state = props.useVisionCard(snapshot => snapshot)
  const [open, setOpen] = useState(false)
  if (!state.available) return null
  const disabled = !state.writable || state.saving
  const field = (name: VisionFieldName, label: VisionLocaleKey, hint: VisionLocaleKey, numeric = false) => (
    <Field
      key={name}
      id={`plugin-config-vision-${name}`}
      label={props.t(label)}
      hint={props.t(hint)}
      state={state.fields[name]}
      disabled={disabled}
      numeric={numeric}
      t={props.t}
      onEdit={text => { props.edit(name, text) }}
      onReset={() => { props.resetField(name) }}
    />
  )
  return (
    <li style={{ ...cardStyle, background: open ? 'var(--dsw-alias-bg-layer-2)' : cardStyle.background }}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${props.t(open ? 'collapse' : 'expand')}: ${props.t('title')}`}
        onClick={() => { setOpen(value => !value) }}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', border: 0, background: 'none', color: 'inherit', textAlign: 'left', cursor: 'pointer', font: 'inherit' }}
      >
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ color: 'var(--dsw-alias-label-primary)', fontSize: 15, fontWeight: 600 }}>{props.t('title')}</span>
          <span style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 13, lineHeight: 1.5 }}>{props.t('description')}</span>
        </span>
        {state.dirty ? <span style={{ color: 'var(--dsw-alias-label-secondary)', fontSize: 11 }}>{props.t('unsaved')}</span> : null}
        <span aria-hidden="true" style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 18, transform: open ? 'rotate(180deg)' : undefined }}>⌄</span>
      </button>
      {open ? (
        <div style={{ margin: '0 16px', paddingBottom: 8, borderTop: '1px solid var(--dsw-alias-border-l2)' }}>
          {!state.writable ? <p role="status" style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 }}>{props.t('readOnly')}</p> : null}
          <SecretField
            id="plugin-config-vision-cloud-key"
            label={props.t('apiKey')}
            hint={props.t('apiKeyHint')}
            text=""
            configured={state.cloudKeyConfigured}
            disabled={!state.cloudKeyWritable || disabled}
            stateLabel={props.t(state.cloudKeyConfigured ? 'apiKeySet' : 'apiKeyUnset')}
            onEdit={text => { props.edit('cloudApiKey', text) }}
          />
          {field('apiKeyEnv', 'apiKeyEnv', 'apiKeyEnvHint')}
          {field('baseURL', 'baseURL', 'baseURLHint')}
          {field('model', 'model', 'modelHint')}
          {field('fallbackModels', 'fallbackModels', 'fallbackModelsHint')}
          {field('maxTokens', 'maxTokens', 'maxTokensHint', true)}
          {field('timeoutMs', 'timeoutMs', 'timeoutMsHint', true)}
          {field('maxImageBytes', 'maxImageBytes', 'maxImageBytesHint', true)}
          {field('retryAttempts', 'retryAttempts', 'retryAttemptsHint', true)}
          {field('retryBackoffMs', 'retryBackoffMs', 'retryBackoffMsHint', true)}
          <SecretField
            id="plugin-config-vision-local-key"
            label={props.t('localApiKey')}
            hint={props.t('localApiKeyHint')}
            text=""
            configured={state.localKeyConfigured}
            disabled={!state.localKeyWritable || disabled}
            stateLabel={props.t(state.localKeyConfigured ? 'localApiKeySet' : 'localApiKeyUnset')}
            onEdit={text => { props.edit('localApiKey', text) }}
          />
          {field('localApiKeyEnv', 'localApiKeyEnv', 'localApiKeyEnvHint')}
          {field('localBaseURL', 'localBaseURL', 'localBaseURLHint')}
          {field('localModel', 'localModel', 'localModelHint')}
          {field('localFallbackModels', 'localFallbackModels', 'localFallbackModelsHint')}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '12px 0 4px', borderTop: '1px solid var(--dsw-alias-border-l2)' }}>
            {state.failed ? <p role="status" style={{ flex: 1, margin: 0, color: 'var(--dsw-alias-label-error)', fontSize: 12 }}>{props.t('saveFailed')}</p> : null}
            <button type="button" style={footerButtonStyle} disabled={!state.dirty || state.saving} onClick={props.discard}>{props.t('discard')}</button>
            <button type="button" style={{ ...footerButtonStyle, borderColor: 'transparent', background: 'var(--dsw-alias-label-primary)', color: 'var(--dsw-alias-bg-layer-3)' }} disabled={!state.dirty || state.invalid || state.saving} onClick={props.save}>{props.t(state.saving ? 'saving' : 'save')}</button>
          </div>
        </div>
      ) : null}
    </li>
  )
}

export function apply(ctx: ClientContext): void {
  const { api } = ctx.get('connection') as ConnectionHandle
  const t = ctx.locale.bind('oh-dsh-vision')
  ctx.effect(() => ctx.locale.register('oh-dsh-vision', { zh, en }), 'oh-dsh-vision: dictionaries')
  const controller = new VisionCardController(
    ctx.settingsScope.bind<VisionSettings>({ namespace: SETTINGS_NAMESPACE }),
    api,
  )
  ctx.effect(
    () => ctx.remote.$on('credentials/updated', ref => { controller.refreshCredential(ref) }),
    'oh-dsh-vision: credential invalidations',
  )
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    id: 'vision',
    order: 30,
    label: () => t('title'),
    locale: 'oh-dsh-vision',
    inject: () => controller.inject(),
  }, VisionCard))
}
