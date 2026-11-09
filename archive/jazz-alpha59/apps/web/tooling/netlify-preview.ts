import { createActor, toPromise } from 'xstate'
import { jazzPreviewBuild } from './preview-machine.ts'
import { provision, waitForApp, run, previewEnvironment } from './preview-runtime.ts'
const actor = createActor(jazzPreviewBuild, {
	input: {
		context: process.env.CONTEXT,
		provision,
		waitForApp,
		deploy: (app, signal) =>
			run(
				'deploy:jazz',
				{ ...previewEnvironment(app.appId), JAZZ_ADMIN_SECRET: app.adminSecret },
				signal
			),
		build: (appId, signal) => run('build', previewEnvironment(appId), signal)
	}
})
const cancel = () => actor.send({ type: 'CANCEL' })
process.once('SIGINT', cancel)
process.once('SIGTERM', cancel)
actor.subscribe((snapshot) => {
	// State names are static. Never inspect or log credential-bearing context/errors.
	console.info(`[preview-build] ${JSON.stringify(snapshot.value)}`)
})
actor.start()
const result = await toPromise(actor)
process.removeListener('SIGINT', cancel)
process.removeListener('SIGTERM', cancel)
if (result.outcome === 'succeeded') {
	console.info(
		`[preview-build] Ready with disposable Jazz app ${result.appId}; expires in 14 days.`
	)
} else {
	console.error(
		`[preview-build] ${result.outcome}; deployment stopped. No shared Jazz app was used.`
	)
	process.exitCode = result.outcome === 'cancelled' ? 130 : 1
}
