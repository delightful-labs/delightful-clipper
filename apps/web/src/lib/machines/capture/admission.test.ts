import { expect, it } from 'vitest'
import { createActor } from 'xstate'
import { captureAdmissionMachine } from './admission.js'
function fixture() {
	const actor = createActor(captureAdmissionMachine).start()
	return {
		actor,
		acquire: (owner: string, now = 0) => {
			let lease: number | undefined
			actor.send({
				type: 'ACQUIRE',
				owner,
				now,
				reply: (value) => {
					lease = value
				}
			})
			return lease
		}
	}
}
it('enforces owner/global concurrency and ignores duplicate lease release', () => {
	const f = fixture()
	const first = f.acquire('a')
	expect(first).toBeDefined()
	f.acquire('a')
	expect(f.acquire('a')).toBeUndefined()
	f.acquire('b')
	f.acquire('b')
	expect(f.acquire('c')).toBeUndefined()
	if (first === undefined) throw new Error('Expected lease')
	f.actor.send({ type: 'RELEASE', lease: first })
	f.actor.send({ type: 'RELEASE', lease: first })
	expect(f.acquire('c')).toBeDefined()
	expect(f.acquire('d')).toBeUndefined()
	f.actor.stop()
})
it('resets the request window while retaining active leases', () => {
	const f = fixture()
	const active = f.acquire('a')
	for (let i = 1; i < 20; i++) {
		const lease = f.acquire('a')
		if (lease === undefined) throw new Error('Expected lease')
		f.actor.send({ type: 'RELEASE', lease })
	}
	expect(f.acquire('a', 59999)).toBeUndefined()
	expect(f.acquire('a', 60000)).toBeDefined()
	expect(f.acquire('a', 60000)).toBeUndefined()
	expect(active).toBeDefined()
	f.actor.stop()
})
it('bounds owner bookkeeping and prunes expired inactive windows', () => {
	const f = fixture()
	for (let i = 0; i < 1024; i++) {
		const lease = f.acquire(String(i))
		if (lease === undefined) throw new Error('Expected lease')
		f.actor.send({ type: 'RELEASE', lease })
	}
	expect(f.acquire('new')).toBeUndefined()
	expect(f.acquire('new', 60000)).toBeDefined()
	expect(Object.keys(f.actor.getSnapshot().context.owners)).toEqual(['new'])
	f.actor.stop()
})
it('treats inherited object-property names as independent owners', () => {
	const f = fixture()
	expect(f.acquire('__proto__')).toBeDefined()
	expect(f.acquire('constructor')).toBeDefined()
	expect(f.actor.getSnapshot().context.owners['__proto__']?.active).toBe(1)
	f.actor.stop()
})
