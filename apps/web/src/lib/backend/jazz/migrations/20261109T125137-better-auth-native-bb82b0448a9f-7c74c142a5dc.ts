import { schema as s, migration as m } from 'jazz-tools'

export default m.defineMigration({
	createTables: {
		better_auth_account: true,
		better_auth_atprotoSession: true,
		better_auth_atprotoState: true,
		better_auth_session: true,
		better_auth_user: true,
		better_auth_verification: true
	},
	fromHash: 'bb82b0448a9f',
	toHash: '7c74c142a5dc',
	from: {},
	to: {
		better_auth_account: s.table(
			{
				accountId: s.string(),
				providerId: s.string(),
				userId: s.uuid(),
				accessToken: s.string().optional(),
				refreshToken: s.string().optional(),
				idToken: s.string().optional(),
				accessTokenExpiresAt: s.timestamp().optional(),
				refreshTokenExpiresAt: s.timestamp().optional(),
				scope: s.string().optional(),
				password: s.string().optional(),
				createdAt: s.timestamp(),
				updatedAt: s.timestamp()
			},
			{
				userIdRelation: s.rel('better_auth_user', 'userId')
			}
		),
		better_auth_atprotoSession: s.table(
			{
				did: s.string(),
				sessionData: s.string(),
				userId: s.uuid().optional(),
				handle: s.string(),
				pdsUrl: s.string(),
				updatedAt: s.timestamp()
			},
			{
				userIdRelation: s.rel('better_auth_user', 'userId')
			}
		),
		better_auth_atprotoState: s.table(
			{
				stateKey: s.string(),
				stateData: s.string(),
				expiresAt: s.timestamp()
			},
			{}
		),
		better_auth_session: s.table(
			{
				expiresAt: s.timestamp(),
				token: s.string(),
				createdAt: s.timestamp(),
				updatedAt: s.timestamp(),
				ipAddress: s.string().optional(),
				userAgent: s.string().optional(),
				userId: s.uuid()
			},
			{
				userIdRelation: s.rel('better_auth_user', 'userId')
			}
		),
		better_auth_user: s.table(
			{
				name: s.string(),
				email: s.string(),
				emailVerified: s.boolean(),
				image: s.string().optional(),
				createdAt: s.timestamp(),
				updatedAt: s.timestamp(),
				atprotoDid: s.string().optional(),
				atprotoHandle: s.string().optional()
			},
			{}
		),
		better_auth_verification: s.table(
			{
				identifier: s.string(),
				value: s.string(),
				expiresAt: s.timestamp(),
				createdAt: s.timestamp(),
				updatedAt: s.timestamp()
			},
			{}
		)
	}
})
