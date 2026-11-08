import { appMigrations, type DeployOptions } from 'jazz-tools/testing'
import { legacyApp } from '../src/lib/backend/jazz/legacy-schema.test-support.js'
import { app as organization } from '../src/lib/backend/jazz/preorganization-schema.test-support.js'
import { app as discovery } from '../src/lib/backend/jazz/prediscovery-schema.test-support.js'
import { app as reader } from '../src/lib/backend/jazz/prereader-schema.test-support.js'
import { app as images } from '../src/lib/backend/jazz/preimages-schema.test-support.js'
import { app as notes } from '../src/lib/backend/jazz/prenotes-schema.test-support.js'
import { app as entities } from '../src/lib/backend/jazz/prenote-entities-schema.test-support.js'
import { app } from '../src/lib/backend/jazz/schema.js'
import urlMigration from '../src/lib/backend/jazz/migrations/20261103T231346-url-first-articles-9251313c0afe-80988faa7219.js'
import organizationMigration from '../src/lib/backend/jazz/migrations/20261105T033336-library-organization-80988faa7219-5315ce57b805.js'
import discoveryMigration from '../src/lib/backend/jazz/migrations/20261105T143555-search-tags-trash-5315ce57b805-86d3840835d8.js'
import readerMigration from '../src/lib/backend/jazz/migrations/20261105T215835-reader-experience-86d3840835d8-3d99c179e109.js'
import imageMigration from '../src/lib/backend/jazz/migrations/20261106T025204-offline-images-3d99c179e109-dc1365b4b2ec.js'
import noteMigration from '../src/lib/backend/jazz/migrations/20261106T144240-article-notes-with-parent-references-dc1365b4b2ec-b7805d9b30d2.js'
import entityMigration from '../src/lib/backend/jazz/migrations/20261106T161431-independent-notes-b7805d9b30d2-92a26a023aa5.js'

// Historical witnesses/lenses with current-SDK structural hashes. This does not
// claim that an alpha.59 database file can be opened by alpha.60.
const steps = [
	{ to: organization, migration: urlMigration },
	{ to: discovery, migration: organizationMigration },
	{ to: reader, migration: discoveryMigration },
	{ to: images, migration: readerMigration },
	{ to: notes, migration: imageMigration },
	{ to: entities, migration: noteMigration },
	{ to: app, migration: entityMigration }
]
export const browserMigrations = await appMigrations(legacyApp, ...steps)
export const fixtureSchemas = [legacyApp, ...steps.map((step) => step.to)]
export function fixtureDeployment(input: DeployOptions) {
	if (!input.migration) return input
	const index = steps.findIndex(
		(step) =>
			step.migration.fromHash === input.migration?.fromHash &&
			step.migration.toHash === input.migration?.toHash
	)
	const edge = browserMigrations.migrations[index]
	if (!edge) throw new Error('Unknown browser migration fixture')
	return {
		...input,
		schemas: fixtureSchemas.slice(index, index + 2),
		migration: { ...input.migration, fromHash: edge.fromHash, toHash: edge.toHash }
	}
}
