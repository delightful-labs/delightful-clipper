import { createHash } from 'node:crypto'

/** Keep existing stores; override only SDK preview names that cannot be provisioned. */
export function jazzCoreName(env: NodeJS.ProcessEnv): string | undefined {
	if (env.CLIPPER_JAZZ_CORE_NAME) return env.CLIPPER_JAZZ_CORE_NAME
	if (env.VERCEL_ENV !== 'preview') return undefined
	const project = env.VERCEL_PROJECT_ID
	const branch = env.VERCEL_GIT_COMMIT_REF
	if (!project || !branch) return undefined // Preserve the SDK's configuration errors.
	const safeProject = project.toLowerCase().replace(/[^a-z0-9]+/g, '-')
	const slug = branch
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 24)
	const hash = createHash('sha256').update(branch).digest('hex').slice(0, 8)
	const generated = `jazz-${safeProject}-preview-${slug}-${hash}`
	if (`${generated}-data`.length <= 64) return undefined
	// Project and full branch determine identity; truncating the display slug must not merge stores.
	const identity = createHash('sha256')
		.update(JSON.stringify([project, branch]))
		.digest('hex')
		.slice(0, 24)
	return `clipper-preview-${slug.slice(0, 18)}-${identity}`
}
