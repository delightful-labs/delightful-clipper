declare module '#jazz-wasm-binary?url' {
	const url: string
	export default url
}

declare namespace App {
	interface Locals {
		gatewayAccountId?: string
	}
}
