import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'

// Rebuild from qualified shared sources. Preserve Clipper's existing alpha.60 SDK
// adaptation separately from the unchanged, published XState implementation.
const [dlfSource, duiSource] = process.argv.slice(2).map((path) => resolve(path))
if (!dlfSource || !duiSource)
	throw new Error('Usage: node tooling/build-v6-vendor.mjs <DLF source> <DUI source>')
const versions = { xstate: '6.0.0-beta.1', jazz: '2.0.0-alpha.60' }
const sources = [
	{
		name: 'delightful-local-first',
		source: dlfSource,
		commit: '2532309d1b1d77518d166c145d392368e9d0fe1c',
		file: 'delightful-local-first-2532309-xstate-v6-jazz-alpha60.tgz'
	},
	{
		name: 'delightful-ui',
		source: duiSource,
		commit: '7a7f61b236220bb5edb2bef4390b9db075775e43',
		file: 'delightful-ui-7a7f61b-xstate-v6.tgz'
	}
]
const directory = mkdtempSync(join(tmpdir(), 'clipper-v6-vendor-'))
const vendor = resolve('vendor')
const provenance = []
/** @param {string} file @param {string} from @param {string} to */
function rewrite(file, from, to) {
	const source = readFileSync(file, 'utf8')
	if (!source.includes(from))
		throw new Error(`Expected alpha.60 adaptation site missing: ${file}: ${from}`)
	writeFileSync(file, source.replaceAll(from, to))
}
for (const item of sources) {
	execFileSync('git', ['diff', '--exit-code', item.commit, '--', 'src/lib', 'package.json'], {
		cwd: item.source,
		stdio: 'inherit'
	})
	execFileSync('pnpm', ['package'], { cwd: item.source, stdio: 'inherit' })
	const stage = join(directory, item.name)
	mkdirSync(stage)
	cpSync(join(item.source, 'dist'), join(stage, 'dist'), { recursive: true })
	const pkg = JSON.parse(readFileSync(join(item.source, 'package.json'), 'utf8'))
	if (item.name === 'delightful-local-first') {
		pkg.peerDependencies['jazz-tools'] = versions.jazz
		const native = join(stage, 'dist/backend/jazz')
		rewrite(
			join(native, 'session.js'),
			"import { createJazzSession } from 'jazz-tools';",
			"import { createJazzClient } from 'jazz-tools/client';"
		)
		rewrite(join(native, 'session.js'), 'createJazzSession(captured)', 'createJazzClient(captured)')
		rewrite(
			join(native, 'session.d.ts'),
			"import { createJazzSession } from 'jazz-tools';",
			"import { createJazzClient } from 'jazz-tools/client';"
		)
		rewrite(join(native, 'session.d.ts'), 'typeof createJazzSession', 'typeof createJazzClient')
		for (const file of [
			'session.d.ts',
			'startup.d.ts',
			'session-readiness.d.ts',
			'restoration.d.ts'
		]) {
			rewrite(join(native, file), "'jazz-tools/svelte'", "'jazz-tools/client'")
			const content = readFileSync(join(native, file), 'utf8')
			writeFileSync(join(native, file), content.replaceAll('JazzSessionConfig', 'JazzClientConfig'))
		}
		rewrite(
			join(native, 'backup.js'),
			"error.code === 'exclusive_conflict'",
			"error.code === 'serialization_conflict' || error.code === 'exclusive_conflict'"
		)
		rewrite(join(native, 'backup.js'), 'session?.user.account', 'session?.user')
		rewrite(join(native, 'backup.js'), 'beginExclusiveTransaction', 'beginSerializableTransaction')
		rewrite(
			join(native, 'backup.d.ts'),
			'beginExclusiveTransaction',
			'beginSerializableTransaction'
		)
		rewrite(
			join(native, 'invitation-authority.js'),
			'import { isRequestAuthenticationError }',
			'import { isRequestAuthenticationError, isNoJazzAccountError }'
		)
		rewrite(
			join(native, 'invitation-authority.js'),
			`const captured = {
                    headers: Object.freeze({
                        authorization: request.headers.get('authorization') ?? undefined
                    })
                };`,
			`const captured = new Request(request.url, { method: request.method, headers: new Headers(request.headers) });`
		)
		rewrite(
			join(native, 'invitation-authority.js'),
			'client.withAttributionForRequest',
			'client.forReqUser'
		)
		rewrite(join(native, 'invitation-authority.js'), 'session?.user.account', 'session?.user')
		rewrite(
			join(native, 'invitation-authority.js'),
			'beginExclusiveTransaction',
			'beginSerializableTransaction'
		)
		rewrite(
			join(native, 'invitation-authority.js'),
			'isRequestAuthenticationError(error) ?',
			'(isRequestAuthenticationError(error) || isNoJazzAccountError(error)) ?'
		)
		for (const [from, to] of new Map([
			['JazzClient', 'Jazz'],
			['withAttributionForRequest', 'forReqUser'],
			['ExclusiveWriteHandle', 'SerializableWriteHandle'],
			["'exclusive'", "'serializable'"]
		])) {
			rewrite(join(native, 'invitation-authority.d.ts'), from, to)
		}
	}
	writeFileSync(join(stage, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
	cpSync(join(item.source, 'README.md'), join(stage, 'README.md'))
	execFileSync('pnpm', ['pack', '--pack-destination', directory], { cwd: stage, stdio: 'inherit' })
	const archive = join(directory, `${pkg.name}-${pkg.version}.tgz`)
	cpSync(archive, join(vendor, item.file))
	provenance.push({
		file: item.file,
		source: item.commit,
		xstate: versions.xstate,
		...(item.name === 'delightful-local-first'
			? {
					jazz: versions.jazz,
					adaptation:
						'Preserves the existing alpha.60 native adapter delta; presentation export remains a separate pnpm patch.'
				}
			: {})
	})
}
/** @type {{file:string;sha256:string}[]} */
const current = JSON.parse(readFileSync(join(vendor, 'manifest.json'), 'utf8'))
for (const item of sources) {
	const sha256 = createHash('sha256')
		.update(readFileSync(join(vendor, item.file)))
		.digest('hex')
	const previous = current.find((entry) => entry.file === item.file)
	if (previous) previous.sha256 = sha256
	else current.push({ file: item.file, sha256 })
}
writeFileSync(join(vendor, 'manifest.json'), JSON.stringify(current, null, '\t') + '\n')
writeFileSync(
	join(vendor, 'xstate-v6-provenance.json'),
	JSON.stringify(provenance, null, '\t') + '\n'
)
