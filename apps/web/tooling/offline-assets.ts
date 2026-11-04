import { z } from 'zod'
import type { Plugin } from 'vite'
const manifestSchema = z.record(
	z.string(),
	z.looseObject({ file: z.string(), assets: z.array(z.string()).optional() })
)
/** One immutable binary path for page and worker output; expose worker dependencies to Kit. */
export function offlineAssets(): Plugin {
	return {
		name: 'clipper-offline-assets',
		apply: 'build',
		configResolved(config) {
			const output = config.worker.rolldownOptions.output
			const outputs = Array.isArray(output) ? output : [output]
			for (const entry of outputs)
				if (entry) entry.assetFileNames = '_app/immutable/assets/[name].[hash][extname]'
		},
		applyToEnvironment: (environment) => environment.name === 'client',
		generateBundle: {
			order: 'post',
			handler(_options, bundle) {
				const setting = this.environment.config.build.manifest
				const path = typeof setting === 'string' ? setting : '.vite/manifest.json'
				const output = bundle[path]
				if (output?.type !== 'asset') this.error('Offline precache requires the client manifest')
				const decoded: unknown = JSON.parse(
					typeof output.source === 'string'
						? output.source
						: new TextDecoder().decode(output.source)
				)
				const parsed = manifestSchema.safeParse(decoded)
				if (!parsed.success) this.error('Invalid client asset manifest')
				const manifest = parsed.data
				const listed = new Set(
					Object.values(manifest).flatMap((entry) => [entry.file, ...(entry.assets ?? [])])
				)
				for (const asset of Object.values(bundle))
					if (
						asset.type === 'asset' &&
						asset.fileName.startsWith('_app/immutable/') &&
						!asset.fileName.endsWith('.map') &&
						!listed.has(asset.fileName)
					)
						manifest[`_offline:${asset.fileName}`] = { file: asset.fileName }
				output.source = JSON.stringify(manifest)
			}
		}
	}
}
