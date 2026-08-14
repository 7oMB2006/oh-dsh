import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import {
  defaultOhDshHome,
  desktopElectronDataRoot,
  resolveOhDshHome,
} from '../src/data-root.ts'

test('all surfaces resolve one shared Oh-DSH state root', () => {
  assert.equal(defaultOhDshHome('/home/user'), join('/home/user', '.ohdsh'))
  assert.equal(resolveOhDshHome({}, '/home/user'), resolve('/home/user/.ohdsh'))
  assert.equal(
    resolveOhDshHome({ OH_DSH_HOME: '/data/oh-dsh' }, '/home/user'),
    resolve('/data/oh-dsh'),
  )
  assert.equal(
    desktopElectronDataRoot('/data/oh-dsh'),
    join('/data/oh-dsh', 'desktop'),
  )
})
