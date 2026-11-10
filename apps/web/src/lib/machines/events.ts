/** Extract a payload when one protocol member groups several literal event names. */
export type EventPayload<Event, Type extends string> = Event extends { type: infer Name }
	? Type extends Name
		? Omit<Event, 'type'>
		: never
	: never
