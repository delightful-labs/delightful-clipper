import { startLocalJazzServer as startCore } from 'jazz-tools/testing'

// Only disposable browser fixtures use this authority. The web app's real SDK
// backend fronts it, retaining registration, capture admission and sync policies.
export const browserCoreSecret = 'clipper-browser-test-authority'
export function startLocalJazzServer(input: Parameters<typeof startCore>[0]) {
	return startCore({
		...input,
		adminSecret: browserCoreSecret,
		backendSecret: browserCoreSecret + '-backend',
		allowLocalFirstAuth: true
	})
}
