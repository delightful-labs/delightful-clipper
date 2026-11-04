/** Credential-free presentation in the isolated world. Text and URLs come from the trusted owner. */
export type BarView = {
	id: string
	revision: number
	reset: boolean
	text: string
	variant: 'info' | 'error'
	href: string
	open: string
	close: string
}
export function renderBar(view: BarView) {
	let host = document.querySelector('delightful-clipper-bar')
	if (!view.reset && host?.getAttribute('data-capture') !== view.id) return
	if (!view.reset && Number(host?.getAttribute('data-revision')) >= view.revision) return
	if (!host) {
		host = document.createElement('delightful-clipper-bar')
		document.documentElement.append(host)
	}
	host.setAttribute('data-capture', view.id)
	host.setAttribute('data-revision', String(view.revision))
	const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
	const style = document.createElement('style')
	style.textContent = `
		:host { all: initial !important; position: fixed !important; inset: 0 0 auto !important; z-index: 2147483647 !important; display: block !important; }
		* { box-sizing: border-box; }
		.bar { display: flex; align-items: center; gap: 16px; min-height: 44px; padding: 8px 16px; background: #f8fafc; color: #17202d; border-bottom: 1px solid #cbd5e1; box-shadow: 0 1px 4px #0002; font: 13px/1.4 system-ui, sans-serif; color-scheme: light; }
		a { color: inherit; font-weight: 600; text-decoration: none; flex-shrink: 0; }
		a:hover { text-decoration: underline; }
		.status { flex: 1; overflow-wrap: anywhere; }
		.error { color: #a31515; }
		button { border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; padding: 4px 8px; }
		:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
	`
	const bar = document.createElement('div')
	bar.className = 'bar'
	const link = document.createElement('a')
	link.textContent = view.open
	link.href = view.href
	link.target = '_blank'
	link.rel = 'noopener noreferrer'
	const status = document.createElement('span')
	status.className = `status ${view.variant}`
	status.setAttribute('role', 'status')
	status.setAttribute('aria-live', 'polite')
	status.textContent = view.text
	const close = document.createElement('button')
	close.type = 'button'
	close.textContent = '×'
	close.setAttribute('aria-label', view.close)
	close.onclick = () => {
		host?.remove()
		document.querySelector('delightful-clipper-space')?.remove()
	}
	bar.append(link, status, close)
	root.replaceChildren(style, bar)
	if (!document.querySelector('delightful-clipper-space')) {
		const spacer = document.createElement('delightful-clipper-space')
		spacer.style.cssText = 'display:block!important;height:44px!important;'
		document.body?.prepend(spacer)
	}
}
