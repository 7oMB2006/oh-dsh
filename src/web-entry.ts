/** Compatibility executable for the original standalone Web launcher. */

import { main, UsageError } from './web.ts'

void main(process.argv.slice(2)).then(code => {
  process.exit(code)
}, error => {
  if (error instanceof UsageError) {
    process.stderr.write(`${error.message}\n`)
    process.exit(2)
  }
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  )
  process.exit(1)
})
