/** Runs in the isolated world after activeTab permission; never receives identity or credentials. */
export function serializePage() {
	if (document.querySelectorAll('*').length > 50000) throw new Error('sourceTooLarge')
	const clone = document.documentElement.cloneNode(true)
	if (!(clone instanceof HTMLElement)) throw new Error('unsupportedMedia')
	for (const element of clone.querySelectorAll(
		'delightful-clipper-bar,delightful-clipper-space,script,style,iframe,frame,object,embed,form,input,textarea,select,button,template,meta,[hidden],[aria-hidden="true"]'
	))
		element.remove()
	for (const element of [clone, ...clone.querySelectorAll('*')])
		for (const attribute of Array.from(element.attributes)) {
			if (
				attribute.name.toLowerCase().startsWith('on') ||
				['srcdoc', 'nonce', 'integrity'].includes(attribute.name.toLowerCase())
			)
				element.removeAttribute(attribute.name)
		}
	const html = new XMLSerializer().serializeToString(clone)
	if (new TextEncoder().encode(html).length > 2 * 1024 * 1024) throw new Error('sourceTooLarge')
	return { url: location.href, base: document.baseURI, html }
}
