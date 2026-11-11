import { afterEach, expect, test, vi } from 'vitest'
import configure from '../vite.config.js'

afterEach(() => vi.unstubAllEnvs())

function target(overrides: Record<string, string> = {}) {
	for (const key of ['EXTENSION_JAZZ_APP_ID', 'EXTENSION_JAZZ_SERVER_URL', 'EXTENSION_WEB_URL'])
		vi.stubEnv(key, undefined)
	for (const [key, value] of Object.entries(overrides)) vi.stubEnv(key, value)
	return configure({ command: 'build', mode: 'production' }).define
}

test('release builds target production even with local web coordinates in the environment', () => {
	const define = target({
		PUBLIC_JAZZ_APP_ID: '8d217851-cec3-4c24-a595-d130259d497c',
		PUBLIC_JAZZ_SERVER_URL: 'http://127.0.0.1:5174/'
	})
	expect(define?.__CLIPPER_APP_ID__).toBe(JSON.stringify('9c0871ad-3ea3-49d0-9eaf-b034914da924'))
	expect(define?.__CLIPPER_SERVER__).toBe(JSON.stringify('https://clipper.delightfullabs.com/jazz'))
	expect(define?.__CLIPPER_WEB__).toBe(JSON.stringify('https://clipper.delightfullabs.com/'))
})

test('explicit development builds keep all three coordinates together', () => {
	const define = target({
		EXTENSION_JAZZ_APP_ID: '2db98ae3-fcf1-41e8-b7d3-9818496bde60',
		EXTENSION_JAZZ_SERVER_URL: 'http://127.0.0.1:5180/jazz',
		EXTENSION_WEB_URL: 'http://127.0.0.1:5180/'
	})
	expect(define?.__CLIPPER_APP_ID__).toBe(JSON.stringify('2db98ae3-fcf1-41e8-b7d3-9818496bde60'))
	expect(define?.__CLIPPER_SERVER__).toBe(JSON.stringify('http://127.0.0.1:5180/jazz'))
	expect(define?.__CLIPPER_WEB__).toBe(JSON.stringify('http://127.0.0.1:5180/'))
})

test.each(['EXTENSION_JAZZ_APP_ID', 'EXTENSION_JAZZ_SERVER_URL', 'EXTENSION_WEB_URL'])(
	'rejects a partial target containing only %s',
	(key) => {
		expect(() => target({ [key]: 'http://localhost:5180/' })).toThrow('Set all three')
	}
)
