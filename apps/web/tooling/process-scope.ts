import { readdirSync, readFileSync } from 'node:fs'
export type ProcessTable = {
	pids: () => string[]
	stat: (pid: string) => string
}
const nativeTable: ProcessTable = {
	pids: () => readdirSync('/proc'),
	stat: (pid) => readFileSync(`/proc/${pid}/stat`, 'utf8')
}
function disappeared(error: unknown) {
	return (
		error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ESRCH')
	)
}
/** Linux stat's command field can contain spaces and parentheses; fields follow its final ')'. */
function processScope(stat: string) {
	const fields = stat
		.slice(stat.lastIndexOf(')') + 2)
		.trim()
		.split(/\s+/)
	const group = fields[2]
	if (!/^[A-Za-z]$/.test(fields[0] ?? '') || !group || !/^\d+$/.test(group))
		throw new Error('Invalid native process stat')
	return { state: fields[0], group: Number(group) }
}
/** A zombie retains its PID/group until its parent reaps it, but cannot execute or receive signals. */
export function linuxProcessGroupAlive(group: number, table: ProcessTable = nativeTable): boolean {
	const scan = () => {
		for (const pid of table.pids()) {
			if (!/^\d+$/.test(pid)) continue
			let stat: string
			try {
				stat = table.stat(pid)
			} catch (error) {
				if (disappeared(error)) continue
				throw error
			}
			const process = processScope(stat)
			if (process.group === group && process.state !== 'Z' && process.state !== 'X') return true
		}
		return false
	}
	// Rescan before declaring quiescence: a live parent may have forked between enumeration and stat.
	return scan() || scan()
}
