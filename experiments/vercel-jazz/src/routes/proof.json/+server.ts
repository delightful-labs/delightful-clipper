// Target admission for the external verifier; no data or credentials are exposed.
export const GET = () =>
	Response.json({
		kind: 'delightful-vercel-jazz-proof',
		jazz: '2.0.0-alpha.60',
		data: 'disposable'
	})
