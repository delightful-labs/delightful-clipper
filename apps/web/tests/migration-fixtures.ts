import { appMigrations, type DeployOptions } from 'jazz-tools/testing'
import { legacyApp } from './fixtures/schema-history/legacy-schema.test-support.js'
import { app as organization } from './fixtures/schema-history/preorganization-schema.test-support.js'
import { app as discovery } from './fixtures/schema-history/prediscovery-schema.test-support.js'
import { app as reader } from './fixtures/schema-history/prereader-schema.test-support.js'
import { app as images } from './fixtures/schema-history/preimages-schema.test-support.js'
import { app as notes } from './fixtures/schema-history/prenotes-schema.test-support.js'
import { app as entities } from './fixtures/schema-history/prenote-entities-schema.test-support.js'
import { app } from '../src/lib/backend/jazz/schema.js'
import { app as beforeMetadata } from './fixtures/schema-history/premetadata-schema.test-support.js'
import metadataMigration from '../src/lib/backend/jazz/migrations/20261110T161543-article-metadata-5e70efdb5795-8a4e11c993e0.js'
import { app as beforeExcerpts } from './fixtures/schema-history/preexcerpt-schema.test-support.js'
import excerptMigration from '../src/lib/backend/jazz/migrations/20261110T152256-article-excerpts-7c74c142a5dc-5e70efdb5795.js'
import { app as beforeAuth } from './fixtures/schema-history/preauth-schema.test-support.js'
import authMigration from '../src/lib/backend/jazz/migrations/20261109T125137-better-auth-native-bb82b0448a9f-7c74c142a5dc.js'
import urlMigration from './fixtures/schema-history/migrations/20261103T231346-url-first-articles-9251313c0afe-80988faa7219.js'
import organizationMigration from './fixtures/schema-history/migrations/20261105T033336-library-organization-80988faa7219-5315ce57b805.js'
import discoveryMigration from './fixtures/schema-history/migrations/20261105T143555-search-tags-trash-5315ce57b805-86d3840835d8.js'
import readerMigration from './fixtures/schema-history/migrations/20261105T215835-reader-experience-86d3840835d8-3d99c179e109.js'
import imageMigration from './fixtures/schema-history/migrations/20261106T025204-offline-images-3d99c179e109-dc1365b4b2ec.js'
import noteMigration from './fixtures/schema-history/migrations/20261106T144240-article-notes-with-parent-references-dc1365b4b2ec-b7805d9b30d2.js'
import entityMigration from './fixtures/schema-history/migrations/20261106T161431-independent-notes-b7805d9b30d2-92a26a023aa5.js'

// Historical witnesses/lenses with current-SDK structural hashes. This does not
// claim that an alpha.59 database file can be opened by alpha.60.
const steps = [
	{ to: organization, migration: urlMigration },
	{ to: discovery, migration: organizationMigration },
	{ to: reader, migration: discoveryMigration },
	{ to: images, migration: readerMigration },
	{ to: notes, migration: imageMigration },
	{ to: entities, migration: noteMigration },
	{ to: beforeAuth, migration: entityMigration },
	{ to: beforeExcerpts, migration: authMigration },
	{ to: beforeMetadata, migration: excerptMigration },
	{ to: app, migration: metadataMigration }
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
		schemas: fixtureSchemas.slice(index, input.schema === app ? undefined : index + 2),
		...(input.schema === app
			? { migrations: steps.slice(index + 1).map((step) => step.migration) }
			: {}),
		migration: { ...input.migration, fromHash: edge.fromHash, toHash: edge.toHash }
	}
}
