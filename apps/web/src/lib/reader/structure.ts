export type ReaderHeading = { id: string; text: string; level: number }
export type ReaderFootnote = { text: string; targetId: string; trigger: HTMLAnchorElement }
/** IDs are generated only after sanitization; stored headings cannot address application controls. */
export function readerHeadings(root: HTMLElement): ReaderHeading[] {
	return Array.from(root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')).flatMap(
		(element, index) => {
			const text = element.textContent?.trim()
			if (!text) return []
			if (!element.id) element.id = `reader-heading-${crypto.randomUUID()}-${index}`
			element.tabIndex = -1
			return [{ id: element.id, text, level: Number(element.tagName.slice(1)) }]
		}
	)
}
export function footnoteFromClick(
	root: HTMLElement,
	event: MouseEvent
): ReaderFootnote | undefined {
	if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
		return undefined
	const target =
		event.target instanceof root.ownerDocument.defaultView!.Element ? event.target : undefined
	const link = target?.closest<HTMLAnchorElement>('a[data-reader-footnote]')
	if (!link || !root.contains(link)) return undefined
	const id = link.hash.slice(1),
		note = root.ownerDocument.getElementById(id)
	if (!note || !root.contains(note)) return undefined
	return { text: note.textContent ?? '', targetId: id, trigger: link }
}
