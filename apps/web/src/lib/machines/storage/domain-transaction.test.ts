import { types, createActor, setup, toPromise, createAsyncLogic } from 'xstate'
import { expect, it, vi } from 'vitest'

import { createDomainTransaction, type PreparedPort } from './domain-transaction.js'
import type { SyncReceipt } from '../../contracts/storage.js'

type Phase = 'open' | 'read' | 'stage' | 'commit' | 'persist'
function fixture(
	options: { pause?: Phase; fail?: Phase; blocked?: boolean; rollbackFails?: boolean } = {}
) {
	const entered = Promise.withResolvers<void>(),
		release = Promise.withResolvers<void>()
	const trace: string[] = []
	async function step(phase: Phase) {
		trace.push(phase)
		if (phase === options.pause) {
			entered.resolve()
			await release.promise
		}
		if (phase === options.fail) throw new Error('storage unavailable')
	}
	const resource = { token: 'one transaction' },
		write = {}
	const receipt: SyncReceipt = { global: vi.fn(async () => {}) }
	type Draft = { id: string }
	type Input = {
		resource: object
		owner: PreparedPort
		attempt: import('delightful-local-first/workspace/creation/contracts').WorkspaceCreationAttempt<Draft>
	}
	const actors = {
		read: createAsyncLogic({
			run: async () => {
				await step('read')
			}
		}),
		stage: createAsyncLogic({
			run: async () => {
				await step('stage')
			}
		})
	}
	const domain = setup({
		schemas: {
			context: types<Input>(),
			events: { STAGE: types(), STAGED: types() },
			input: types<Input>(),
			output: types<SyncReceipt>(),
			tags: types<string>(),
			children: {
				read: types<import('xstate').ActorRefFrom<(typeof actors)['read']>>(),
				stage: types<import('xstate').ActorRefFrom<(typeof actors)['stage']>>()
			}
		},
		actors,
		guards: { allowed: () => !options.blocked },
		actions: {}
	}).createMachine({
		context: ({ input }) => input,
		initial: 'reading',
		output: () => receipt,
		states: {
			reading: { invoke: { id: 'read', src: 'read', onDone: { target: 'checking' } } },
			checking: {
				type: 'choice',
				choice: (args) => {
					if (args.guards.allowed()) {
						return { target: 'ready' }
					}
					return { target: 'blocked' }
				}
			},
			ready: {
				entry: (args, enq) => {
					enq.sendTo(args.context.owner, {
						type: 'PREPARED',
						assessment: { outcome: 'eligible' }
					})
				},
				on: { STAGE: { target: 'staging' } }
			},
			staging: { invoke: { id: 'stage', src: 'stage', onDone: { target: 'done' } } },
			blocked: {
				entry: (args, enq) => {
					enq.sendTo(args.context.owner, {
						type: 'PREPARED',
						assessment: { outcome: 'blocked', reason: 'unavailable' }
					})
				}
			},
			done: { type: 'final' }
		}
	})
	const rollback = vi.fn(async () => {
		trace.push('rollback')
		return !options.rollbackFails
	})
	const logic = createDomainTransaction<Draft, object, object>(
		(spawn, input) => spawn(domain, { input }),
		{
			retainDetached: vi.fn(),
			open: async () => {
				await step('open')
				return resource
			},
			commit: async (current) => {
				expect(current).toBe(resource)
				await step('commit')
				return write
			},
			persistLocal: async (current) => {
				expect(current).toBe(write)
				await step('persist')
			},
			rollback
		}
	)
	const attempt = {
		operationId: 'operation',
		workspaceId: 'workspace',
		membershipId: 'membership',
		draft: { id: 'operation' }
	}
	const actor = createActor(logic, { input: { attempt } })
	const result = toPromise(actor)
	actor.start()
	return { actor, result, attempt, trace, receipt, resource, entered, release, rollback }
}
it('keeps one DLF transaction and returns the original intent without accepting remote sync', async () => {
	const f = fixture()
	const result = await f.result
	expect(result.attempt).toBe(f.attempt)
	expect(result.settlement).toEqual({ kind: 'locallyPersisted', workspace: f.receipt })
	expect(f.trace).toEqual(['open', 'read', 'stage', 'commit', 'persist'])
	expect(f.resource).toEqual({ token: 'one transaction' })
	expect(f.receipt.global).not.toHaveBeenCalled()
})
it('rolls back a domain refusal without issuing a mutation or commit', async () => {
	const f = fixture({ blocked: true })
	expect((await f.result).outcome).toBe('blocked')
	expect(f.trace).toEqual(['open', 'read', 'rollback'])
})
for (const phase of ['read', 'stage'] as const) {
	it(`returns a ${phase} failure to DLF for rollback`, async () => {
		const f = fixture({ fail: phase })
		expect((await f.result).settlement.kind).toBe('notStarted')
		expect(f.rollback).toHaveBeenCalledOnce()
		expect(f.trace).not.toContain('commit')
	})
}
for (const [phase, event] of [
	['open', 'CANCEL'],
	['read', 'CANCEL'],
	['stage', 'SHUTDOWN']
] as const) {
	it(`drains ${phase} before ${event} rolls back`, async () => {
		const f = fixture({ pause: phase })
		await f.entered.promise
		f.actor.send({ type: event })
		expect(f.actor.getSnapshot().status).toBe('active')
		expect(f.rollback).not.toHaveBeenCalled()
		f.release.resolve()
		const result = await f.result
		expect(result.outcome).toBe(event === 'CANCEL' ? 'cancelled' : 'closed')
		expect(result.settlement.kind).toBe('notStarted')
		expect(f.rollback).toHaveBeenCalledOnce()
		expect(f.trace).not.toContain('commit')
	})
}
it('drains an already issued commit and preserves its local receipt after cancellation', async () => {
	const f = fixture({ pause: 'commit' })
	await f.entered.promise
	f.actor.send({ type: 'CANCEL' })
	f.release.resolve()
	const result = await f.result
	expect(result.outcome).toBe('cancelled')
	expect(result.settlement.kind).toBe('locallyPersisted')
	expect(f.trace).toEqual(['open', 'read', 'stage', 'commit', 'persist'])
	expect(f.rollback).not.toHaveBeenCalled()
})
for (const phase of ['commit', 'persist'] as const) {
	it(`preserves an unknown ${phase} outcome without replay`, async () => {
		const f = fixture({ fail: phase })
		expect((await f.result).settlement.kind).toBe('unresolved')
		expect(f.trace.filter((item) => item === 'stage')).toHaveLength(1)
		expect(f.rollback).toHaveBeenCalledOnce()
	})
}
it('retains an unresolved outcome when rollback is not confirmed', async () => {
	const f = fixture({ blocked: true, rollbackFails: true })
	expect((await f.result).settlement.kind).toBe('unresolved')
})
