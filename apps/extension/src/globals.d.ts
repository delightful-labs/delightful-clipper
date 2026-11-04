declare const __CLIPPER_APP_ID__: string
declare const __CLIPPER_SERVER__: string
declare const __CLIPPER_WEB__: string
declare module '@mozilla/readability/JSDOMParser.js' {
	export default class JSDOMParser {
		parse(html: string): Document
	}
}
