import { selectAtprotoView } from '../../machines/runtime/atproto.js'
import type { LibraryArticle } from '../../contracts/articles.js'
import type { SnapshotFrom } from 'xstate'
import type { workerHostMachine } from './host-machine.js'
import { selectApplicationView } from '../../machines/runtime/application-readiness.js'
import { selectLibraryView } from '../../machines/capture/library.js'
import { selectTagFormView } from '../../machines/capture/tag-form.js'
import { normalizedSource } from '../../capture/source.js'
function rowView({ tagVocabulary: _vocabulary, ...row }: LibraryArticle) {
	return row
}
const readerRevisions = new WeakMap<object, string>()
function readerRevision(reader: object | undefined) {
	if (!reader) return ''
	const existing = readerRevisions.get(reader)
	if (existing) return existing
	const revision = crypto.randomUUID()
	readerRevisions.set(reader, revision)
	return revision
}
/** Only explicit render projections cross the channel. SDK/actor contexts never do. */
function projectRuntimePayload(snapshot: SnapshotFrom<typeof workerHostMachine>) {
	const application = snapshot.children.application?.getSnapshot()
	const library = snapshot.context.library?.getSnapshot()
	const view = selectLibraryView(library)
	const rows = view.rows.slice(0, snapshot.context.limit).map(rowView)
	const context = library?.context
	const tagArticle = context?.rows.find((row) => row.id === snapshot.context.tagArticleId)
	const content = context?.reader
	const reader =
		content?.kind === 'available'
			? {
					kind: content.kind,
					document: { title: content.document.title, snapshotId: content.document.snapshotId },
					text: content.text,
					asset: content.asset
				}
			: content
	const article = context?.rows.find(
		(row) => row.id === context.readerId || row.contentId === context.readerId
	)
	let sourceUrl: string | undefined
	try {
		if (content?.kind === 'available' && content.source)
			sourceUrl = normalizedSource(content.source.finalUrl)
	} catch {
		/* rejected sources do not become links */
	}
	const { ids: _ids, ...search } = view.search
	const { positions: _positions, progress: _progress, ...experience } = view.readerExperience
	const progress =
		reader?.kind === 'available'
			? (view.readerExperience.progress[reader.document.snapshotId] ?? 0)
			: 0
	return {
		scope: snapshot.context.scope,
		account: selectApplicationView(application, true),
		oauth: selectAtprotoView(snapshot.children.oauth?.getSnapshot()),
		library: snapshot.context.library
			? {
					scope: snapshot.context.scope,
					rows,
					total: view.rows.length,
					hasMore: rows.length < view.rows.length,
					listMessage: view.listMessage,
					view: {
						...view,
						rows,
						readable: Object.fromEntries(
							rows.map((row) => [row.id, view.readable[row.id] === true])
						),
						search,
						readerExperience: {
							...experience,
							progress:
								reader?.kind === 'available' ? { [reader.document.snapshotId]: progress } : {}
						}
					},
					filters: {
						query: context?.query ?? '',
						view: context?.view ?? 'all',
						favorites: context?.favorites ?? false,
						selectedTags: context?.selectedTags ?? []
					},
					canAdd: library?.can({ type: 'ADD', url: '' }) === true,
					reader,
					readerRevision: readerRevision(content),
					tagArticle: tagArticle ? rowView(tagArticle) : undefined,
					article: article
						? { id: article.id, trashed: article.trashed, status: article.status }
						: undefined,
					sourceUrl,
					tagForm: selectTagFormView(snapshot.context.tagForm?.getSnapshot())
				}
			: undefined,
		worker: { windowPresent: typeof window !== 'undefined' }
	}
}
export type RuntimeView = ReturnType<typeof projectRuntimePayload> & { type: 'VIEW' }
export function projectRuntime(snapshot: SnapshotFrom<typeof workerHostMachine>): RuntimeView {
	return { type: 'VIEW', ...projectRuntimePayload(snapshot) }
}
export type LibraryRender = NonNullable<RuntimeView['library']>
