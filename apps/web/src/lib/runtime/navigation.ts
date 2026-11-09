import { createContext } from 'svelte'

export const [getAccountNavigation, setAccountNavigation] = createContext<{
	readonly open: boolean
}>()
