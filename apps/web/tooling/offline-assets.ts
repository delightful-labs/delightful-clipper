import type { Plugin } from 'vite'
type Manifest = Record<string, { file: string; assets?: string[] }>
function isManifest(value: unknown): value is Manifest {
	return (
		!!value &&
		typeof value === 'object' &&
		Object.values(value).every(
			(entry) =>
				entry &&
				typeof entry === 'object' &&
				'file' in entry &&
				typeof entry.file === 'string' &&
				(!('assets' in entry) ||
					(Array.isArray(entry.assets) &&
						entry.assets.every((asset: unknown) => typeof asset === 'string')))
		)
	)
}
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
				if (!isManifest(decoded)) this.error('Invalid client asset manifest')
				const listed = new Set(
					Object.values(decoded).flatMap((entry) => [entry.file, ...(entry.assets ?? [])])
				)
				for (const asset of Object.values(bundle))
					if (
						asset.type === 'asset' &&
						asset.fileName.startsWith('_app/immutable/') &&
						!asset.fileName.endsWith('.map') &&
						!listed.has(asset.fileName)
					)
						decoded[`_offline:${asset.fileName}`] = { file: asset.fileName }
				output.source = JSON.stringify(decoded)
			}
		}
	}
}
