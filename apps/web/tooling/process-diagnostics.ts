const TAIL_LIMIT = 16384
export function appendDiagnostic(tail: string, chunk: string) {
	return (tail + chunk).slice(-TAIL_LIMIT)
}
/** Return only an allowlisted operation's numeric HTTP status, never raw stderr. */
export function deploymentHttpStatus(tail: string) {
	return tail.match(
		/(?:Permissions head fetch|Schema publish|Schema fetch|Schema list fetch|Permissions publish|Migration publish) failed:\s*(\d{3})\b/
	)?.[1]
}
