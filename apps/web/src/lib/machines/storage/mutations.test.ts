import { stageIntent } from './mutations.js'
import { expect, it, vi } from 'vitest'
import { createActor, toPromise } from 'xstate'
import {
	intentMutationMachine,
	publicationMutationMachine,
	attachmentMutationMachine
} from './mutations.js'
function fixture() {
	const order: string[] = []
	const receipt = { global: async () => {} }
	const leaf = (name: string) => () => {
		order.push(name)
	}
	return { order, receipt, leaf }
}
it.each([
	{ articleLinked: false, existingArticle: false, expected: ['intent'] },
	{ articleLinked: true, existingArticle: false, expected: ['intent', 'create'] },
	{ articleLinked: true, existingArticle: true, expected: ['intent', 'bind'] }
])(
	'selects intent mutations from transaction-local article state: $expected',
	async ({ articleLinked, existingArticle, expected }) => {
		const f = fixture()
		const actor = createActor(intentMutationMachine, {
			input: {
				articleLinked,
				existingArticle,
				insertIntent: f.leaf('intent'),
				createArticle: f.leaf('create'),
				bindArticle: f.leaf('bind'),
				receipt: () => f.receipt
			}
		}).start()
		expect(await toPromise(actor)).toBe(f.receipt)
		expect(f.order).toEqual(expected)
	}
)
it.each([
	{ articleLinked: false, hasSource: false, expected: ['content'] },
	{ articleLinked: false, hasSource: true, expected: ['content', 'source'] },
	{ articleLinked: true, hasSource: true, expected: ['content', 'attach', 'source'] }
])(
	'publishes only the selected content/link/provenance operations: $expected',
	async ({ articleLinked, hasSource, expected }) => {
		const f = fixture()
		await toPromise(
			createActor(publicationMutationMachine, {
				input: {
					articleLinked,
					hasSource,
					publishContent: f.leaf('content'),
					attachContent: f.leaf('attach'),
					publishSource: f.leaf('source'),
					receipt: () => f.receipt
				}
			}).start()
		)
		expect(f.order).toEqual(expected)
	}
)
it.each([true, false])(
	'selects attachment without running the other mutation (exists: %s)',
	async (existingArticle) => {
		const f = fixture()
		await toPromise(
			createActor(attachmentMutationMachine, {
				input: {
					existingArticle,
					createArticle: f.leaf('create'),
					attachContent: f.leaf('attach'),
					receipt: () => f.receipt
				}
			}).start()
		)
		expect(f.order).toEqual([existingArticle ? 'attach' : 'create'])
	}
)
it('stops staging after a native mutation throws, before attachment or provenance publication', async () => {
	const attachContent = vi.fn(),
		publishSource = vi.fn(),
		receipt = vi.fn(() => ({ global: async () => {} }))
	const actor = createActor(publicationMutationMachine, {
		input: {
			articleLinked: true,
			hasSource: true,
			publishContent: () => {
				throw new Error('native staging failed')
			},
			attachContent,
			publishSource,
			receipt
		}
	})
	const result = toPromise(actor)
	actor.start()
	await expect(result).rejects.toThrow('native staging failed')
	expect(attachContent).not.toHaveBeenCalled()
	expect(publishSource).not.toHaveBeenCalled()
})

it('returns a failed synchronous staging operation to its transaction owner as a rejection', async () => {
	await expect(
		stageIntent({
			articleLinked: true,
			existingArticle: false,
			insertIntent: () => {},
			bindArticle: () => {},
			createArticle: () => {
				throw new Error('native insert rejected')
			},
			receipt: () => ({ global: async () => {} })
		})
	).rejects.toThrow('native insert rejected')
})
