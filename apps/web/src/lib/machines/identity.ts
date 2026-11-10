import { createAsyncLogic } from 'xstate'

/** Native identity issuance runs only for an accepted, owned invocation. */
export const identityLogic = createAsyncLogic({ run: async () => crypto.randomUUID() })
