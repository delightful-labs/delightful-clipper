import { expect, it, vi } from 'vitest'
import { linuxProcessGroupAlive } from './process-scope.js'
const stat = (group: number, state: string, command = 'fixture') =>
	`42 (${command}) ${state} 1 ${group} 0 0 0`
it.each(['R', 'S', 'D', 'T', 't', 'I'])('retains a group containing a %s process', (state) => {
	expect(linuxProcessGroupAlive(42, { pids: () => ['42'], stat: () => stat(42, state) })).toBe(true)
})
it('does not wait for unreaped zombies or dead members after their code has stopped', () => {
	expect(
		linuxProcessGroupAlive(42, {
			pids: () => ['42', '43', '44', 'self'],
			stat: (pid) => stat(pid === '44' ? 99 : 42, pid === '43' ? 'X' : 'Z')
		})
	).toBe(false)
})
it('retains a live descendant alongside dead group members and ignores other groups', () => {
	expect(
		linuxProcessGroupAlive(42, {
			pids: () => ['42', '43', '44'],
			stat: (pid) => stat(pid === '44' ? 99 : 42, pid === '42' ? 'Z' : 'S')
		})
	).toBe(true)
})
it('decodes commands containing whitespace and closing parentheses', () => {
	expect(
		linuxProcessGroupAlive(42, { pids: () => ['42'], stat: () => stat(42, 'S', 'worker (job) )') })
	).toBe(true)
})
it('rescans before reporting a quiescent group to observe a newly forked member', () => {
	const pids = vi.fn().mockReturnValueOnce(['42']).mockReturnValue(['42', '43'])
	expect(
		linuxProcessGroupAlive(42, { pids, stat: (pid) => stat(42, pid === '42' ? 'Z' : 'S') })
	).toBe(true)
})
it('tolerates processes disappearing during enumeration', () => {
	expect(
		linuxProcessGroupAlive(42, {
			pids: () => ['42'],
			stat: () => {
				throw Object.assign(new Error('gone'), { code: 'ENOENT' })
			}
		})
	).toBe(false)
})
it('does not declare disappearance when the table is inaccessible or malformed', () => {
	expect(() =>
		linuxProcessGroupAlive(42, {
			pids: () => ['42'],
			stat: () => {
				throw Object.assign(new Error('denied'), { code: 'EACCES' })
			}
		})
	).toThrow('denied')
	expect(() => linuxProcessGroupAlive(42, { pids: () => ['42'], stat: () => 'invalid' })).toThrow(
		'Invalid native process stat'
	)
})
