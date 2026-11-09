import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
export const jazzWasmEntry = createRequire(require.resolve('jazz-tools/package.json')).resolve(
	'jazz-wasm'
)
