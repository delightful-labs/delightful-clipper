import { createActor, toPromise } from 'xstate'
import { decodeResponseMachine } from '../../machines/capture/decode-response.js'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import ipaddr from 'ipaddr.js'
import { promisify } from 'node:util'
import { gunzip, brotliDecompress, inflate } from 'node:zlib'
import { CaptureError } from './errors.js'
export const BODY_LIMIT = 10 * 1024 * 1024
export type Hop = {
	status: number
	location: string | undefined
	mediaType: string
	body: Uint8Array
}
/** One pinned connection, no ambient proxy/credentials/pool, closed before settlement. */
export async function fetchHop(
	url: URL,
	destination: { address: string; family: number },
	signal: AbortSignal
): Promise<Hop> {
	const response = await new Promise<Hop>((resolve, reject) => {
		const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
			url,
			{
				method: 'GET',
				rejectUnauthorized: true,
				agent: false,
				signal,
				maxHeaderSize: 16 * 1024,
				headers: {
					Accept: 'text/html,application/xhtml+xml,text/plain',
					'Accept-Encoding': 'gzip, deflate, br',
					'User-Agent': 'Delightful-Clipper/1'
				},
				lookup: (_host, options, callback) => {
					if (options.all)
						callback(null, [{ address: destination.address, family: destination.family }])
					else callback(null, destination.address, destination.family)
				}
			},
			(incoming) => {
				const peer = incoming.socket.remoteAddress
				if (
					!peer ||
					ipaddr.process(peer).toNormalizedString() !==
						ipaddr.process(destination.address).toNormalizedString() ||
					!isIP(destination.address)
				) {
					incoming.destroy()
					request.destroy()
					reject(new CaptureError('redirectBlocked', 400))
					return
				}
				const status = incoming.statusCode ?? 502
				const location = incoming.headers.location
				const mediaType = incoming.headers['content-type'] ?? ''
				if (status !== 200) {
					incoming.destroy()
					resolve({ status, location, mediaType, body: new Uint8Array() })
					return
				}
				const chunks: Buffer[] = []
				let size = 0
				incoming.on('data', (chunk: Buffer) => {
					size += chunk.length
					if (size > BODY_LIMIT) incoming.destroy(new CaptureError('sourceTooLarge', 413))
					else chunks.push(chunk)
				})
				incoming.once('error', reject)
				incoming.once('end', () => {
					const wire = Buffer.concat(chunks)
					const encoding = incoming.headers['content-encoding']?.trim().toLowerCase()
					const formats = {
						gzip: promisify(gunzip),
						br: promisify(brotliDecompress),
						deflate: promisify(inflate)
					}
					void toPromise(
						createActor(decodeResponseMachine, {
							input: {
								wire,
								encoding,
								headers: { status, location, mediaType },
								decode: (format, bytes) =>
									formats[format](bytes, {
										maxOutputLength: Math.min(BODY_LIMIT, Math.max(1024, bytes.length * 100))
									})
							}
						}).start()
					).then((result) => {
						if (result.error) reject(result.error)
						else resolve(result.hop)
					}, reject)
				})
			}
		)
		request.once('error', reject)
		request.end()
	})
	signal.throwIfAborted()
	return response
}
