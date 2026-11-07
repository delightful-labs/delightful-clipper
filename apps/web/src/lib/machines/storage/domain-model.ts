import { assign, fromPromise, sendTo, setup } from 'xstate'
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
		read: fromPromise(({ input }: { input: TransactionDomainInput<Draft> }) =>
			read(input.resource, input.attempt.draft, input.attempt.operationId)
		)
	}
	return setup<
		DomainContext<Draft, Facts>,
		{ type: 'STAGE' },
		typeof actors,
		{},
		{
			rememberFacts: { facts: Facts }
			allow: undefined
			block: undefined
		},
		{},
		never,
		string,
		TransactionDomainInput<Draft>,
		SyncReceipt
	>({
		actors,
		actions: {
			rememberFacts: assign({ facts: (_, params) => params.facts }),
			allow: sendTo(({ context }) => context.owner, {
				type: 'PREPARED',
				assessment: { outcome: 'eligible' }
			}),
			block: sendTo(({ context }) => context.owner, {
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
