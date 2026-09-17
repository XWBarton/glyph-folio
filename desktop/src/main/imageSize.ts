/** Minimal, dependency-free pixel-dimension readers for the raster formats docx can embed. */

export type ImageFormat = 'png' | 'jpg' | 'gif' | 'bmp'

export interface ImageDimensions {
  width: number
  height: number
}

export function detectImageFormat(filename: string): ImageFormat | null {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  if (ext === 'png') return 'png'
  if (ext === 'jpg' || ext === 'jpeg') return 'jpg'
  if (ext === 'gif') return 'gif'
  if (ext === 'bmp') return 'bmp'
  return null
}

function readPng(buf: Buffer): ImageDimensions | null {
  if (buf.length < 24) return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

function readGif(buf: Buffer): ImageDimensions | null {
  if (buf.length < 10) return null
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
}

function readBmp(buf: Buffer): ImageDimensions | null {
  if (buf.length < 26) return null
  return { width: buf.readInt32LE(18), height: Math.abs(buf.readInt32LE(22)) }
}

function readJpeg(buf: Buffer): ImageDimensions | null {
  let i = 2 // skip SOI marker (0xFFD8)
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue }
    const marker = buf[i + 1]
    // SOF0..SOF15 markers (excluding DHT/JPG/DAC) carry the frame dimensions
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    const segmentLength = buf.readUInt16BE(i + 2)
    if (isSof) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }
    i += 2 + segmentLength
  }
  return null
}

export function getImageDimensions(buf: Buffer, format: ImageFormat): ImageDimensions | null {
  try {
    switch (format) {
      case 'png': return readPng(buf)
      case 'gif': return readGif(buf)
      case 'bmp': return readBmp(buf)
      case 'jpg': return readJpeg(buf)
    }
  } catch {
    return null
  }
}
