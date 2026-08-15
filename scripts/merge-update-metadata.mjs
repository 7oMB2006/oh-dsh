import { readFileSync, writeFileSync } from 'node:fs'
import YAML from 'yaml'
import { mergeMetadata } from './update-metadata.mjs'

const args = process.argv.slice(2)
const outputIndex = args.indexOf('--output')
const output = outputIndex === -1 ? undefined : args[outputIndex + 1]
const inputs = []
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--input' && args[index + 1] !== undefined) inputs.push(args[index + 1])
}
if (output === undefined || inputs.length === 0) throw new Error('usage: merge-update-metadata.mjs --input FILE --input FILE --output FILE')
const documents = inputs.map(path => YAML.parse(readFileSync(path, 'utf8')))
writeFileSync(output, YAML.stringify(mergeMetadata(documents)))
console.log(`merged ${String(inputs.length)} updater metadata files into ${output}`)
