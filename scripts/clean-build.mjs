import { rm } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

const packageRoot = resolve(import.meta.dirname, '..')
const output = resolve(packageRoot, 'lib')

if (dirname(output) !== packageRoot || basename(output) !== 'lib') {
  throw new Error(`Refusing to clean unexpected output directory: ${output}`)
}

await rm(output, { recursive: true, force: true })
