/** Header-only allocation admission. The decoder still validates the full encoded image. */
export function imageDimensions(bytes: Uint8Array) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	const ascii = (offset: number, length: number) =>
		new TextDecoder('ascii').decode(bytes.subarray(offset, offset + length))
	if (
		bytes.length >= 24 &&
		ascii(1, 3) === 'PNG' &&
		view.getUint32(0) === 0x89504e47 &&
		ascii(12, 4) === 'IHDR'
	)
		return { width: view.getUint32(16), height: view.getUint32(20) }
	if (bytes.length >= 10 && /^GIF8[79]a$/.test(ascii(0, 6)))
		return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
	if (bytes.length >= 21 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
		const kind = ascii(12, 4)
		if (kind === 'VP8X' && bytes.length >= 30)
			return {
				width: 1 + (view.getUint32(24, true) & 0xffffff),
				height: 1 + (view.getUint32(26, true) >>> 8)
			}
		if (
			kind === 'VP8 ' &&
			bytes.length >= 30 &&
			bytes[23] === 0x9d &&
			bytes[24] === 0x01 &&
			bytes[25] === 0x2a
		)
			return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff }
		if (kind === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
			const bits = view.getUint32(21, true)
			return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) }
		}
	}
	if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
		let offset = 2
		while (offset + 4 <= bytes.length) {
			if (bytes[offset] !== 0xff) return undefined
			const marker = bytes[offset + 1]!
			if (marker === 0xff) {
				offset++
				continue
			}
			if (marker === 0xd9 || marker === 0xda) return undefined
			const size = view.getUint16(offset + 2)
			if (size < 2 || offset + 2 + size > bytes.length) return undefined
			if (
				[0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
					marker
				) &&
				size >= 7
			)
				return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) }
			offset += size + 2
		}
	}
	return undefined
}
