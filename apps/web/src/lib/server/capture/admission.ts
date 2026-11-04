import { CaptureError } from './errors.js'
// Instance-local abuse bound, not a distributed quota or persistent account store.
let active = 0
const owners = new Map<string, { start: number; count: number; active: number }>()
export function acquireCapture(owner: string) {
	const now = Date.now()
	if (active >= 4) throw new CaptureError('rateLimited', 429, true)
	for (const [id, value] of owners)
		if (value.active === 0 && now - value.start >= 60000) owners.delete(id)
	let value = owners.get(owner)
	if (!value) {
		if (owners.size >= 1024) throw new CaptureError('rateLimited', 429, true)
		value = { start: now, count: 0, active: 0 }
		owners.set(owner, value)
	}
	if (now - value.start >= 60000) {
		value.start = now
		value.count = 0
	}
	if (value.active >= 2 || value.count >= 20) throw new CaptureError('rateLimited', 429, true)
	value.active++
	active++
	value.count++
	return () => {
		value.active--
		active--
	}
}
