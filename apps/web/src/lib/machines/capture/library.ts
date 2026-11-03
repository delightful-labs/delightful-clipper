import { syncOwnerMachine } from '../storage/sync-owner.js'
import { readRecordMachine } from '../storage/read.js'
import { assign, enqueueActions, fromCallback, sendTo, setup, stopChild } from 'xstate'
import { preparationMachine } from './preparation.js'
import type { SaveRef } from '../../contracts/library.js'
import type { LibraryCapability, LibraryEvent } from '../../contracts/library.js'
import type { DocumentHeader, ReadResult, SaveResult } from '../../contracts/storage.js'
import type { Candidate } from '../../capture/source.js'
type Context = {
	capability: LibraryCapability | undefined
	closing: boolean
	writing: boolean
	saveRef: SaveRef | undefined
	url: string
	candidate: Candidate | undefined
	captureId: string
	readerId: string
	readerGeneration: number
	reader: ReadResult | undefined
	rows: DocumentHeader[]
	listFailed: boolean
	sync: Record<string, 'pending' | 'accepted' | 'rejected'>
	failure: string
}
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Library unavailable')
	return value
}
const actors = {
	collection: fromCallback<LibraryEvent, LibraryCapability | undefined>(({ input, sendBack }) => {
		try {
			return input?.subscribe(
				(rows) => sendBack({ type: 'ROWS', rows }),
				() => sendBack({ type: 'LIST_FAILED' })
			)
		} catch {
			sendBack({ type: 'LIST_FAILED' })
			return undefined
		}
	}),
	receipts: syncOwnerMachine,
	prepare: preparationMachine,
	read: readRecordMachine
}
export const libraryMachine = setup<
	Context,
	| LibraryEvent
	| { type: `xstate.done.actor.${string}`; actorId: string; output: SaveResult }
	| { type: `xstate.error.actor.${string}`; actorId: string; error: unknown },
	typeof actors,
	{},
	{ close: undefined },
	{},
	never,
	string,
	LibraryCapability | undefined
>({
	actors,
	actions: {
		close: enqueueActions(({ context, enqueue }) => {
			if (context.saveRef) enqueue.sendTo(context.saveRef, { type: 'SHUTDOWN' })
			enqueue.sendTo('receipts', { type: 'SHUTDOWN' })
			enqueue.assign({
				closing: true,
				candidate: undefined,
				reader: undefined,
				rows: [],
				url: '',
				sync: {}
			})
		})
	}
}).createMachine({
	id: 'library',
	initial: 'running',
	context: ({ input }) => ({
		capability: input,
		closing: false,
		writing: false,
		saveRef: undefined,
		url: '',
		candidate: undefined,
		captureId: '',
		readerId: '',
		readerGeneration: 0,
		reader: undefined,
		rows: [],
		listFailed: false,
		sync: {},
		failure: ''
	}),
	states: {
		running: {
			type: 'parallel',
			invoke: [
				{ id: 'collection', src: 'collection', input: ({ context }) => context.capability },
				{ id: 'receipts', src: 'receipts', input: ({ self }) => ({ reportTo: self }) }
			],
			always: { guard: ({ context }) => context.closing && !context.writing, target: 'closed' },
			on: {
				SHUTDOWN: { actions: 'close' },
				ROWS: {
					guard: ({ context }) => !context.closing && !!context.capability?.isCurrent(),
					actions: assign({ rows: ({ event }) => event.rows, listFailed: false })
				},
				LIST_FAILED: { actions: assign({ listFailed: true }) },
				SYNC: {
					guard: ({ context }) => !context.closing && !!context.capability?.isCurrent(),
					actions: assign({
						sync: ({ context, event }) => ({ ...context.sync, [event.id]: event.status })
					})
				}
			},
			states: {
				capture: {
					initial: 'idle',
					states: {
						idle: {
							on: {
								ADD: {
									guard: ({ context }) => !!context.capability?.isCurrent(),
									target: 'preparing',
									actions: assign({
										url: ({ event }) => event.url,
										candidate: undefined,
										failure: ''
									})
								}
							}
						},
						preparing: {
							invoke: {
								src: 'prepare',
								input: ({ context }) => ({
									capability: required(context.capability),
									url: context.url
								}),
								onDone: [
									{
										guard: ({ event }) => event.output.kind === 'scopeChanged',
										target: 'idle',
										actions: assign({ candidate: undefined, url: '' })
									},
									{
										guard: ({ event }) => event.output.kind === 'ready',
										target: 'saving',
										actions: assign({
											candidate: ({ event }) =>
												event.output.kind === 'ready' ? event.output.candidate : undefined
										})
									},
									{
										guard: ({ event }) => event.output.kind === 'duplicate',
										target: 'duplicate',
										actions: assign({
											captureId: ({ event }) =>
												event.output.kind === 'duplicate' || event.output.kind === 'uncertain'
													? event.output.id
													: ''
										})
									},
									{
										target: 'uncertain',
										actions: assign({
											captureId: ({ event }) =>
												event.output.kind === 'duplicate' || event.output.kind === 'uncertain'
													? event.output.id
													: ''
										})
									}
								],
								onError: {
									target: 'failed',
									actions: assign({
										failure: ({ event }) =>
											event.error instanceof Error ? event.error.message : 'captureFailed'
									})
								}
							},
							on: { CANCEL: { target: 'idle', actions: assign({ url: '', candidate: undefined }) } }
						},
						saving: {
							initial: 'active',
							entry: assign(({ context, spawn }) => {
								const candidate = required(context.candidate)
								return {
									writing: true,
									captureId: candidate.id,
									saveRef: required(context.capability).spawnSave(
										(logic, options) => spawn(logic, options),
										{
											operationId: candidate.id,
											title: candidate.title,
											text: candidate.text,
											bytes: new TextEncoder().encode(candidate.html),
											mediaType: 'text/html',
											source: {
												finalUrl: candidate.finalUrl,
												submittedUrl: candidate.submittedUrl,
												provenance: candidate.provenance
											}
										}
									)
								}
							}),
							exit: [
								stopChild(({ context }) => required(context.saveRef)),
								assign({ writing: false, candidate: undefined, saveRef: undefined })
							],
							states: {
								active: {
									on: {
										CANCEL: {
											target: 'stopping',
											actions: sendTo(({ context }) => required(context.saveRef), {
												type: 'SHUTDOWN'
											})
										}
									}
								},
								stopping: {}
							},
							on: {
								SHUTDOWN: { target: '.stopping', actions: 'close' },
								'xstate.done.actor.*': [
									{
										guard: ({ context, event }) =>
											context.closing && event.actorId === context.saveRef?.id,
										target: 'canceled'
									},
									{
										guard: ({ context, event }) =>
											event.actorId === context.saveRef?.id && event.output.kind === 'saved',
										target: 'saved',
										actions: [
											assign({
												captureId: ({ event }) => event.output.operationId,
												sync: ({ context, event }) => ({
													...context.sync,
													[event.output.operationId]: 'pending'
												})
											}),
											sendTo('receipts', ({ event }) => ({
												type: 'WATCH',
												id: event.output.operationId,
												receipts: event.output.kind === 'saved' ? event.output.receipts : []
											}))
										]
									},
									{
										guard: ({ context, event }) =>
											event.actorId === context.saveRef?.id && event.output.kind === 'failed',
										target: 'saveFailed'
									},
									{
										guard: ({ context, event }) =>
											event.actorId === context.saveRef?.id && event.output.kind === 'interrupted',
										target: 'canceled'
									},
									{
										guard: ({ context, event }) => event.actorId === context.saveRef?.id,
										target: 'uncertain',
										actions: assign({ captureId: ({ event }) => event.output.operationId })
									}
								],
								'xstate.error.actor.*': {
									guard: ({ context, event }) => event.actorId === context.saveRef?.id,
									target: 'uncertain'
								}
							}
						},
						saved: {
							on: {
								ADD: { target: 'preparing', actions: assign({ url: ({ event }) => event.url }) }
							}
						},
						duplicate: {
							on: {
								ADD: { target: 'preparing', actions: assign({ url: ({ event }) => event.url }) }
							}
						},
						saveFailed: {
							on: {
								ADD: { target: 'preparing', actions: assign({ url: ({ event }) => event.url }) }
							}
						},
						canceled: {
							on: {
								ADD: { target: 'preparing', actions: assign({ url: ({ event }) => event.url }) }
							}
						},
						uncertain: {
							on: {
								ADD: { target: 'preparing', actions: assign({ url: ({ event }) => event.url }) }
							}
						},
						failed: {
							on: {
								ADD: {
									target: 'preparing',
									actions: assign({ url: ({ event }) => event.url, failure: '' })
								}
							}
						}
					}
				},
				reading: {
					initial: 'empty',
					on: {
						OPEN: {
							target: '.loading',
							reenter: true,
							actions: assign({
								readerId: ({ event }) => event.id,
								readerGeneration: ({ context }) => context.readerGeneration + 1,
								reader: undefined
							})
						},
						CLOSE_READER: {
							target: '.empty',
							actions: assign({
								reader: undefined,
								readerGeneration: ({ context }) => context.readerGeneration + 1
							})
						},
						READ_RESULT: {
							guard: ({ context, event }) =>
								event.generation === context.readerGeneration &&
								!context.closing &&
								!!context.capability?.isCurrent(),
							target: '.shown',
							actions: assign({ reader: ({ event }) => event.result })
						}
					},
					states: {
						empty: {},
						loading: {
							invoke: {
								src: 'read',
								input: ({ context, self }) => ({
									capability: required(context.capability).read,
									id: context.readerId,
									generation: context.readerGeneration,
									reportTo: self
								}),
								onError: { target: 'shown', actions: assign({ reader: { kind: 'unavailable' } }) }
							}
						},
						shown: {}
					}
				}
			}
		},
		closed: {
			type: 'final',
			entry: assign({
				capability: undefined,
				candidate: undefined,
				reader: undefined,
				rows: [],
				sync: {},
				url: '',
				captureId: '',
				failure: ''
			})
		}
	}
})
