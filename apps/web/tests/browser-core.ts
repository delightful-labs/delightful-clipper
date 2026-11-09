import { startLocalJazzServer as startCore } from 'jazz-tools/testing'

// Only disposable browser fixtures use this authority. The web app's real SDK
// backend fronts it, retaining registration, capture admission and sync policies.
export const browserCoreSecret = 'clipper-browser-test-authority'
export function startLocalJazzServer(input: Parameters<typeof startCore>[0]) {
	// createJazz publishes the real schema graph; pre-installing only its latest
	// schema would choose a different genesis before that graph arrives.
	const { schema: _schema, permissions: _permissions, ...store } = input
	return startCore({
		...store,
		adminSecret: browserCoreSecret,
		backendSecret: browserCoreSecret + '-backend',
		allowLocalFirstAuth: true
	})
}
