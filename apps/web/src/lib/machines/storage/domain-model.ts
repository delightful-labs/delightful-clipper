import { types, setup, createAsyncLogic } from 'xstate'

import type { SyncReceipt } from '../../contracts/storage.js'
import type { TransactionResource } from '../../backend/jazz/transaction.js'
import type { TransactionDomainInput } from './domain-transaction.js'

export type DomainContext<Draft, Facts> = TransactionDomainInput<Draft> & {
	facts: Facts | undefined
}
export type DomainRead<Draft, Facts> = (
	resource: TransactionResource,
	draft: Draft,
	operationId: string
) => Promise<Facts>
export type DomainMutation<Draft> = (resource: TransactionResource, draft: Draft) => void
export type DomainReceipt = (resource: TransactionResource) => SyncReceipt

/** Common read/output protocol only. Eligibility and mutation paths are defined
 * by each domain chart; no application decision lives in this composition. */
export function transactionDomainModel<Draft, Facts>(
	read: DomainRead<Draft, Facts>,
	reason: string
) {
	const actors = {
		read: createAsyncLogic({
			run: ({ input }: { input: TransactionDomainInput<Draft> }) =>
				read(input.resource, input.attempt.draft, input.attempt.operationId)
		})
	}
	return setup({
		schemas: {
			context: types<DomainContext<Draft, Facts>>(),
			events: { STAGE: types(), STAGED: types() },
			input: types<TransactionDomainInput<Draft>>(),
			output: types<SyncReceipt>(),
			tags: types<string>(),
			children: { read: types<import('xstate').ActorRefFrom<(typeof actors)['read']>>() }
		},
		actors,
		actions: {
			rememberFacts: (_: unknown, params: { facts: Facts }) => ({
				context: { facts: params.facts }
			}),
			allow: ({ context }: { context: DomainContext<Draft, Facts> }) =>
				context.owner.send({
					type: 'PREPARED',
					assessment: { outcome: 'eligible' }
				}),
			block: ({ context }: { context: DomainContext<Draft, Facts> }) =>
				context.owner.send({
					type: 'PREPARED',
					assessment: { outcome: 'blocked', reason }
				})
		}
	})
}
export function domainContext<Draft, Facts>({
	input
}: {
	input: TransactionDomainInput<Draft>
}): DomainContext<Draft, Facts> {
	return { ...input, facts: undefined }
}
