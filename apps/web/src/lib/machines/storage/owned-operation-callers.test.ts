import { createActor, createAsyncLogic, setup, toPromise, types } from 'xstate'
import { expect, it, vi } from 'vitest'
import type {
	WorkspaceCreationAttempt,
	WorkspaceCreationResult
} from 'delightful-local-first/workspace/creation/contracts'
import { createSaveRecordMachine } from './save.js'
import { createSaveArticleMachine } from './save-article.js'
import { createOrganizationMachine, type OrganizationDraft } from './organize.js'
import { createFakeDataMachine } from '../../samples/machine.js'
import type { FakeDataPlan } from '../../samples/plan.js'
import { prepareSave } from '../../storage/prepare.js'
import type {
	ArticleDraft,
	ArticleStageInput,
	ArticleStageResult
} from '../../contracts/articles.js'
import type { SaveRequest, SaveResult, StageInput, StageResult } from '../../contracts/storage.js'

const samplePlan = vi.hoisted(() => [])
vi.mock('../../samples/plan.js', () => ({ prepareFakeData: async () => samplePlan }))

/** Observe input inside the actual capability-spawned child, after invocation. */
function operation<Input, Output>(finish: (input: Input) => Output) {
	const inputs: Input[] = []
	const receive = createAsyncLogic<Output, Input>({
		run: async ({ input }) => {
			inputs.push(input)
			return finish(input)
		}
	})
	const logic = setup({
		schemas: {
			context: types<{ record: { input: Input; output: Output | undefined } }>(),
			input: types<Input>(),
			output: types<Output>(),
			events: { SHUTDOWN: types(), CANCEL: types() }
		},
		actors: { receive }
	}).createMachine({
		context: ({ input }) => ({ record: { input, output: undefined } }),
		initial: 'receiving',
		output: ({ context }): Output => context.record.output!,
		states: {
			receiving: {
				invoke: {
					id: 'receive',
					src: 'receive',
					input: ({ context }) => context.record.input,
					onDone: ({ context, event }) => ({
						target: 'done',
						context: { record: { ...context.record, output: event.output } }
					})
				}
			},
			done: { type: 'final' }
		}
	})
	return { logic, inputs }
}

function request(): SaveRequest {
	return {
		operationId: crypto.randomUUID(),
		title: 'Title',
		text: 'Prepared content',
		bytes: new Uint8Array([1]),
		mediaType: 'text/plain'
	}
}

it('passes the prepared identity and payload to both actual intent/publication children in order', async () => {
	const input = request()
	const prepared = await prepareSave(crypto.randomUUID(), input)
	const receipt = { global: vi.fn(async () => {}) }
	const sequence: string[] = []
	const intent = operation<StageInput, StageResult>((received) => {
		sequence.push('intent')
		return {
			attempt: received.attempt,
			outcome: 'succeeded',
			settlement: { kind: 'locallyPersisted', workspace: receipt }
		}
	})
	const publish = operation<StageInput, StageResult>((received) => {
		sequence.push('publish')
		return {
			attempt: received.attempt,
			outcome: 'succeeded',
			settlement: { kind: 'locallyPersisted', workspace: receipt }
		}
	})
	const actor = createActor(
		createSaveRecordMachine({
			isCurrent: () => true,
			prepare: async () => prepared,
			intent: (spawn, received) => spawn(intent.logic, { input: received }),
			publish: (spawn, received) => spawn(publish.logic, { input: received })
		}),
		{ input }
	).start()
	const result = await toPromise(actor)
	expect(sequence).toEqual(['intent', 'publish'])
	for (const received of [intent.inputs, publish.inputs]) {
		expect(received).toHaveLength(1)
		expect(received[0]!.attempt).toEqual({
			operationId: input.operationId,
			workspaceId: input.operationId,
			membershipId: input.operationId,
			draft: prepared
		})
		expect(received[0]!.attempt.draft).toBe(prepared)
	}
	expect(result.kind === 'saved' && result.receipts).toEqual([receipt, receipt])
	expect(receipt.global).not.toHaveBeenCalled()
})

it.each(['ensure', 'attach', 'content'] as const)(
	'preserves the actual article %s child input and domain outcome',
	async (selected) => {
		const content = request()
		const draft: ArticleDraft = {
			article: {
				id: 'article',
				libraryId: 'library',
				url: 'https://example.com/',
				originalSavedAt: '2026-11-04',
				contentId: null,
				operationId: null,
				failure: null
			},
			target: 'content',
			...(selected === 'content' ? { content } : {})
		}
		const receipt = { global: vi.fn(async () => {}) }
		const finish = (received: ArticleStageInput): ArticleStageResult => ({
			attempt: received.attempt,
			outcome: 'succeeded',
			settlement: { kind: 'locallyPersisted', workspace: receipt }
		})
		const ensure = operation(finish)
		const attach = operation(finish)
		const save = operation<SaveRequest, SaveResult>(() => ({
			kind: 'saved',
			operationId: content.operationId,
			receipts: [receipt]
		}))
		const actor = createActor(
			createSaveArticleMachine({
				isCurrent: () => true,
				prepare: async () => draft,
				read: async () => null,
				document: async () =>
					selected === 'attach'
						? {
								id: 'content',
								libraryId: 'library',
								operationId: 'original',
								snapshotId: 'snapshot',
								assetId: 'asset',
								title: 'Title',
								originalSavedAt: '2026-11-04'
							}
						: null,
				intent: async () => false,
				ensure: (spawn, input) => spawn(ensure.logic, { input }),
				attach: (spawn, input) => spawn(attach.logic, { input }),
				content: (spawn, input) => spawn(save.logic, { input })
			}),
			{ input: { url: draft.article.url } }
		).start()
		const result = await toPromise(actor)
		expect(ensure.inputs.length + attach.inputs.length + save.inputs.length).toBe(1)
		if (selected === 'content') expect(save.inputs[0]).toBe(content)
		else {
			const input = (selected === 'ensure' ? ensure : attach).inputs[0]!
			expect(input.attempt).toEqual({
				operationId: 'article',
				workspaceId: 'article',
				membershipId: 'article',
				draft
			})
			expect(input.attempt.draft).toBe(draft)
		}
		expect(result.kind).toBe(selected === 'attach' ? 'duplicate' : 'saved')
		expect(
			result.kind === 'saved' || result.kind === 'duplicate' ? result.receipts[0] : undefined
		).toBe(receipt)
		expect(receipt.global).not.toHaveBeenCalled()
	}
)

it('passes the admitted organization identity and history to the actual write child', async () => {
	const history: OrganizationDraft['operations'] = []
	const receipt = { global: vi.fn(async () => {}) }
	const stage = operation<
		{ attempt: WorkspaceCreationAttempt<OrganizationDraft> },
		WorkspaceCreationResult<OrganizationDraft, typeof receipt>
	>((input) => ({
		attempt: input.attempt,
		outcome: 'succeeded',
		settlement: { kind: 'locallyPersisted', workspace: receipt }
	}))
	const actor = createActor(
		createOrganizationMachine(
			(spawn, input) => spawn(stage.logic, { input }),
			() => true,
			async () => history
		),
		{ input: { id: 'article', field: 'status', value: 'later' } }
	).start()
	const result = await toPromise(actor)
	expect(stage.inputs).toHaveLength(1)
	const attempt = stage.inputs[0]!.attempt
	expect(attempt.operationId).toBe(result.operationId)
	expect(attempt.workspaceId).toBe(result.operationId)
	expect(attempt.membershipId).toBe(result.operationId)
	expect(attempt.draft).toMatchObject({ id: 'article', field: 'status', value: 'later' })
	expect(attempt.draft.operations).toBe(history)
	expect(result.kind).toBe('saved')
})

it('passes the prepared sample plan and library identity to the actual seed child', async () => {
	const stage = operation<
		{ attempt: WorkspaceCreationAttempt<FakeDataPlan> },
		WorkspaceCreationResult<FakeDataPlan, number>
	>((input) => ({
		attempt: input.attempt,
		outcome: 'succeeded',
		settlement: { kind: 'locallyPersisted', workspace: 24 }
	}))
	const actor = createActor(
		createFakeDataMachine({
			enabled: true,
			libraryId: 'library',
			isCurrent: () => true,
			local: async () => ({ hasData: false, owned: true }),
			authority: async () => ({ hasData: false, owned: true }),
			stage: (spawn, input) => spawn(stage.logic, { input })
		})
	).start()
	expect(await toPromise(actor)).toBe('seeded')
	expect(stage.inputs).toHaveLength(1)
	expect(stage.inputs[0]!.attempt).toEqual({
		operationId: 'library',
		workspaceId: 'library',
		membershipId: 'library',
		draft: samplePlan
	})
	expect(stage.inputs[0]!.attempt.draft).toBe(samplePlan)
})
