import {
	startLocalJazzServer as startCore,
	startTestJazz,
	deploy as deployCore,
	type LocalJazzServerHandle,
	type StartLocalJazzServerOptions,
	type DeployOptions,
	type TestJazz
} from 'jazz-tools/testing'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fixtureSchemas, browserMigrations, fixtureDeployment } from './migration-fixtures.js'
import { browserCoreSecret } from './browser-core.js'

const sdk = dirname(createRequire(import.meta.url).resolve('jazz-tools'))
const {
	shipMigrations
}: {
	shipMigrations(
		schema: (typeof fixtureSchemas)[number]['wasmSchema'],
		bundle: typeof browserMigrations
	): void
} = await import(pathToFileURL(join(sdk, 'runtime/client-migrations.js')).href)
function shipVersion(schema: DeployOptions['schema'], connected: boolean) {
	const index = fixtureSchemas.findIndex((version) => version === schema)
	if (index < 0) throw new Error('Unknown browser fixture schema')
	const versions = connected
		? browserMigrations.schemas.slice(0, index + 1)
		: browserMigrations.schemas.slice(index, index + 1)
	shipMigrations(fixtureSchemas[index]!.wasmSchema, {
		schemas: versions,
		migrations: connected ? browserMigrations.migrations.slice(0, index) : []
	})
}
type Entry = { core: LocalJazzServerHandle; port: number; backend?: TestJazz }
const endpoints = new Map<string, Entry>()
/** SDK-owned authority and backend; every deployment keeps the public endpoint stable. */
export async function startLocalJazzServer(input: StartLocalJazzServerOptions) {
	for (const schema of fixtureSchemas) shipVersion(schema, false)
	const core = await startCore({
		...input,
		port: 0,
		adminSecret: browserCoreSecret,
		backendSecret: browserCoreSecret + '-backend',
		allowLocalFirstAuth: true
	})
	const entry: Entry = { core, port: input.port ?? 0 }
	endpoints.set(core.url, entry)
	return {
		...core,
		get url() {
			return entry.backend?.url ?? core.url
		},
		async stop() {
			try {
				await entry.backend?.stop()
			} finally {
				await core.stop()
				endpoints.delete(core.url)
				if (entry.backend) endpoints.delete(entry.backend.url)
			}
		}
	}
}
export async function deploy(input: DeployOptions) {
	const entry = endpoints.get(input.serverUrl)
	if (!entry) throw new Error('Missing browser migration authority')
	const normalized = { ...fixtureDeployment(input), serverUrl: entry.core.url }
	if (!entry.backend) {
		const result = await deployCore(normalized)
		shipVersion(input.schema, Boolean(input.migration))
		entry.backend = await startTestJazz({
			core: entry.core,
			port: entry.port,
			app: input.schema,
			permissions: input.permissions,
			jazz: {
				allowedOrigins: [process.env.CLIPPER_SCHEMA_BROWSER_ORIGIN ?? 'http://127.0.0.1:5180']
			}
		})
		endpoints.set(entry.backend.url, entry)
		return result
	}
	if (input.migration) shipVersion(input.schema, true)
	return entry.backend.redeploy({
		app: input.schema,
		permissions: input.permissions,
		...(normalized.migration ? { migration: normalized.migration } : {}),
		...(normalized.schemas ? { schemas: normalized.schemas } : {})
	})
}
