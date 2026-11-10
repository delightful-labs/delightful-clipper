import { expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { featuredImageUrl } from './metadata.js'

it('falls back from invalid Open Graph images to Twitter and never accepts active or credential URLs', () => {
	const dom = new JSDOM(
		`<meta property="og:image" content="javascript:alert(1)"><meta property="og:image" content="https://user:secret@example.com/image"><meta name="twitter:image" content="../cover.png">`
	)
	try {
		expect(
			featuredImageUrl(
				dom.window.document.getElementsByTagName('meta'),
				'https://example.com/posts/article'
			)
		).toBe('https://example.com/cover.png')
	} finally {
		dom.window.close()
	}
})
