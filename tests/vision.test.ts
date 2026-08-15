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
  assert.match(prompt, /native image attachment/)
  assert.match(prompt, /configured vision endpoint/)
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
