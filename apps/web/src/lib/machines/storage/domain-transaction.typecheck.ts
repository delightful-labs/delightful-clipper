import type { ActorRef, Snapshot } from 'xstate'
import type { ChildSpawner } from '../children.js'
import type { ArticleDraft } from '../../contracts/articles.js'
import type { PreparedPort, TransactionDomainInput } from './domain-transaction.js'
import type { createArticleEnsureDomain, ArticleFailure } from './article-domains.js'

/** Compile-only protocol regressions, included by the web TypeScript check. */
export function checkTransactionProtocols(
	unrelated: ActorRef<Snapshot<undefined>, { type: 'UNRELATED' }>,
	owner: PreparedPort,
	spawn: ChildSpawner,
	article: ReturnType<typeof createArticleEnsureDomain>,
	input: TransactionDomainInput<ArticleDraft>,
	wrongInput: TransactionDomainInput<ArticleFailure>
) {
	// @ts-expect-error An unrelated actor cannot acknowledge domain preparation.
	const invalidOwner: PreparedPort = unrelated
	void invalidOwner
	owner.send({ type: 'PREPARED', assessment: { outcome: 'eligible' } })
	// @ts-expect-error The preparation port does not expose transaction staging.
	owner.send({ type: 'STAGE' })
	spawn(article, { input })
	// @ts-expect-error The concrete domain source checks the draft at its producer.
	spawn(article, { input: wrongInput })
}
