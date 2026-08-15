import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { mergeMetadata, verifyMetadata } from '../scripts/update-metadata.mjs'

async function asset(dir: string, name: string, content: string) {
  const path = join(dir, name)
  await writeFile(path, content)
  const data = Buffer.from(content)
  return {
    url: `https://github.com/hust-open-atom-club/oh-dsh/releases/download/v1.2.0/${name}`,
    sha512: createHash('sha512').update(data).digest('base64'),
    size: data.length,
  }
}

test('metadata verification selects one architecture and validates SHA-512', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oh-dsh-metadata-'))
  const arm = await asset(dir, 'Oh-DSH-Desktop-1.2.0-arm64.zip', 'arm')
  const x64 = await asset(dir, 'Oh-DSH-Desktop-1.2.0-x64.zip', 'x64')
  await writeFile(join(dir, 'latest-mac.yml'), [
    'version: 1.2.0',
    'files:',
    `  - ${JSON.stringify(arm)}`,
    `  - ${JSON.stringify(x64)}`,
  ].join('\n'))
  const result = verifyMetadata({ dir, version: '1.2.0', platform: 'mac-arm64' })
  assert.equal(result.selected, arm.url.split('/').pop())
  await writeFile(join(dir, 'Oh-DSH-Desktop-1.2.0-arm64.zip'), 'tampered')
  assert.throws(() => verifyMetadata({ dir, version: '1.2.0', platform: 'mac-arm64' }), /sha512 mismatch/)
})

test('metadata merge combines macOS architectures and rejects version conflicts', () => {
  const arm = { version: '1.2.0', files: [{ url: 'https://example/arm.zip', sha512: 'arm', size: 1 }] }
  const x64 = { version: '1.2.0', files: [{ url: 'https://example/x64.zip', sha512: 'x64', size: 1 }] }
  const merged = mergeMetadata([arm, x64])
  assert.deepEqual(merged.files.map(file => file.url), ['https://example/arm.zip', 'https://example/x64.zip'])
  assert.throws(() => mergeMetadata([arm, { ...x64, version: '1.3.0' }]), /different versions/)
})

test('metadata verification rejects web distribution assets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oh-dsh-metadata-'))
  await mkdir(join(dir, 'nested'))
  const app = await asset(dir, 'Oh-DSH-Desktop-1.2.0-x86_64.AppImage', 'app')
  const web = await asset(dir, 'oh-dsh-web-1.2.0-linux-x64.zip', 'web')
  await writeFile(join(dir, 'latest-linux.yml'), [
    'version: 1.2.0',
    'files:',
    `  - ${JSON.stringify(app)}`,
    `  - ${JSON.stringify(web)}`,
  ].join('\n'))
  assert.throws(() => verifyMetadata({ dir, version: '1.2.0', platform: 'linux-x64' }), /web distribution/)
})
