import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  apply,
  DEFAULT_FREE_FALLBACKS,
  resolveVisionConfig,
} from '../plugins/vision/src/index.ts'
import { VisionAttachmentRegistry } from '../plugins/vision/src/attachment-registry.ts'
import { decodeVisionAttachmentUpload } from '../plugins/vision/src/attachment-server.ts'
import { VisionDraftStore } from '../plugins/vision/src/client/draft-store.ts'
import {
  visionAttachmentToken,
  visionModelReference,
} from '../plugins/vision/src/protocol.ts'
import {
  isRetriableVisionError,
  toImageUrl,
  visionChat,
  VisionHttpError,
} from '../plugins/vision/src/vlm.ts'

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

test('vision defaults preserve the upstream free-model fallback chain', () => {
  const defaults = resolveVisionConfig({})
  assert.equal(defaults.model, 'glm-4.6v-flash')
  assert.equal(defaults.apiKeyEnv, 'VISION_API_KEY')
  assert.deepEqual(defaults.fallbackModels, DEFAULT_FREE_FALLBACKS)

  const local = resolveVisionConfig({
    baseURL: 'http://localhost:11434/v1',
    model: 'qwen3-vl:4b',
  })
  assert.deepEqual(local.fallbackModels, [])
})

test('vision plugin registers one shared tool and prompt section', () => {
  let toolName = ''
  let prompt = ''
  const context = {
    credentials: { resolve: async () => undefined },
    effect: (effect: () => unknown) => effect(),
    get: () => undefined,
    inject: () => {},
    systemPrompt: {
      section: (entry: { text: string }) => {
        prompt = entry.text
        return () => {}
      },
    },
    tools: {
      register: (definition: { name: string }) => {
        toolName = definition.name
        return () => {}
      },
    },
  }

  apply(context as never, {})

  assert.equal(toolName, 'view_image')
  assert.match(prompt, /active Session workspace/)
  assert.match(prompt, /browser-pasted image reference/)
  assert.match(prompt, /configured vision endpoint/)
})

test('pasted attachment references are durable and bound to one Session', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oh-dsh-vision-registry-'))
  try {
    const registry = new VisionAttachmentRegistry(root)
    const attachment = {
      attachmentId: 'sha256-test' as never,
      bytes: 128,
      height: 10,
      mediaType: 'image/png' as const,
      name: 'shot.png',
      width: 20,
    }
    const source = await registry.register('session-a', attachment)
    assert.ok(visionAttachmentToken(source))
    assert.deepEqual(await new VisionAttachmentRegistry(root).resolve(source, 'session-a'), attachment)
    await assert.rejects(registry.resolve(source, 'session-b'), /another Session/)
    assert.match(visionModelReference(source), /view_image tool/)
    assert.match(visionModelReference(source), new RegExp(source))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('pasted image uploads validate canonical data, media type, and name', () => {
  assert.deepEqual(decodeVisionAttachmentUpload({
    data: 'AAAA',
    mediaType: 'image/png',
    name: '../screens\\shot.png',
    sessionId: 'session-a',
  }, 8), {
    data: new Uint8Array([0, 0, 0]),
    mediaType: 'image/png',
    name: 'shot.png',
    sessionId: 'session-a',
  })
  assert.throws(() => decodeVisionAttachmentUpload({
    data: 'A===',
    mediaType: 'image/png',
    sessionId: 'session-a',
  }, 8), /invalid or too large/)
  assert.throws(() => decodeVisionAttachmentUpload({
    data: 'AAAA',
    mediaType: 'image/svg+xml',
    sessionId: 'session-a',
  }, 8), /unsupported/)
})

test('pasted image draft lifetime follows its input reference', async () => {
  let finishUpload: ((source: string) => void) | undefined
  const revoked: string[] = []
  const store = new VisionDraftStore({
    createPreview: () => 'blob:preview',
    revokePreview: value => { revoked.push(value) },
    upload: async () => await new Promise(resolve => { finishUpload = resolve }),
  })
  const file = { name: 'shot.png', type: 'image/png' } as File
  store.add('session-a', 'draft-a', file)
  assert.equal(store.list('session-a')[0]?.status, 'uploading')

  const source = 'oh-dsh-attachment:00000000-0000-4000-8000-000000000000'
  finishUpload?.(source)
  assert.equal(await store.serialize('draft-a', new AbortController().signal), source)
  assert.equal(store.list('session-a')[0]?.status, 'ready')

  store.prune('session-a', new Set())
  assert.deepEqual(store.list('session-a'), [])
  assert.deepEqual(revoked, ['blob:preview'])
})

test('local image resolution stays inside the active workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oh-dsh-vision-'))
  const workspace = join(root, 'workspace')
  const image = join(workspace, 'shot.png')
  const outside = join(root, 'outside.png')
  try {
    await mkdir(workspace)
    await writeFile(image, PNG_BYTES)
    await writeFile(outside, PNG_BYTES)

    assert.equal(
      await toImageUrl('shot.png', 1024, workspace),
      `data:image/png;base64,${PNG_BYTES.toString('base64')}`,
    )
    await assert.rejects(
      toImageUrl(outside, 1024, workspace),
      /outside the active Session workspace/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('image data URLs enforce MIME and byte limits', async () => {
  const valid = `data:image/png;base64,${PNG_BYTES.toString('base64')}`
  assert.equal(await toImageUrl(valid, PNG_BYTES.byteLength), valid)
  await assert.rejects(toImageUrl(valid, PNG_BYTES.byteLength - 1), /byte limit/)
  await assert.rejects(toImageUrl('data:text/plain;base64,QQ==', 8), /unsupported data URL MIME/)
})

test('vision request uses the OpenAI-compatible shape and removes reasoning', async () => {
  let requestUrl = ''
  let requestBody: unknown
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requestUrl = String(url)
    requestBody = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({
      choices: [{ message: { content: '<think>inspect pixels</think>\nA red panda.' } }],
    }), { status: 200 })
  }) as typeof fetch

  const answer = await visionChat({
    apiKey: 'sk-test',
    baseURL: 'https://vision.example/v1/',
    fetch: fakeFetch,
    maxImageBytes: 1024,
    maxTokens: 512,
    model: 'vision-model',
    question: 'What animal is shown?',
    source: 'data:image/png;base64,AAAA',
    timeoutMs: 5_000,
  })

  assert.equal(answer, 'A red panda.')
  assert.equal(requestUrl, 'https://vision.example/v1/chat/completions')
  assert.deepEqual(requestBody, {
    model: 'vision-model',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
        { type: 'text', text: 'What animal is shown?' },
      ],
    }],
  })
})

test('vision HTTP failures redact credentials and classify fallback statuses', async () => {
  const fakeFetch = (async () => new Response('bad key sk-secret', { status: 429 })) as typeof fetch
  await assert.rejects(
    visionChat({
      apiKey: 'sk-secret',
      baseURL: 'https://vision.example/v1',
      fetch: fakeFetch,
      maxImageBytes: 1024,
      maxTokens: 512,
      model: 'vision-model',
      question: 'What is shown?',
      source: 'data:image/png;base64,AAAA',
      timeoutMs: 5_000,
    }),
    (error: unknown) => {
      assert.ok(error instanceof VisionHttpError)
      assert.equal(error.status, 429)
      assert.equal(isRetriableVisionError(error), true)
      assert.doesNotMatch(error.message, /sk-secret/)
      assert.match(error.message, /bad key \*\*\*/)
      return true
    },
  )
  assert.equal(isRetriableVisionError(new VisionHttpError('bad request', 400)), false)
})
