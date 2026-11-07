export function noteAttempt<T extends { id: string }>(draft: T) {
	return {
		attempt: { operationId: draft.id, workspaceId: draft.id, membershipId: draft.id, draft }
	}
}
