import { createContext, type Snippet } from 'svelte'

export const [getAccountSettings, setAccountSettings] = createContext<{
	readonly controls: Snippet
}>()
