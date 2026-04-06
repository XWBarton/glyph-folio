import Foundation

/// Minimal ZIP writer (Store method, no compression).
/// Supports files up to 4 GB (ZIP32 compatible).
struct ZipArchive {
    private struct Entry {
        let name: String
        let data: Data
        let crc: UInt32
        let localHeaderOffset: UInt32
    }

    private var buffer = Data()
    private var entries: [Entry] = []

    mutating func add(name: String, data: Data) {
        let crc = Self.crc32(data)
        let offset = UInt32(buffer.count)

        // Local file header
        buffer += Self.uint32LE(0x04034b50)  // signature
        buffer += Self.uint16LE(20)           // version needed
        buffer += Self.uint16LE(0)            // general purpose bit flag
        buffer += Self.uint16LE(0)            // compression method: stored
        buffer += Self.uint16LE(0)            // last mod file time
        buffer += Self.uint16LE(0)            // last mod file date
        buffer += Self.uint32LE(crc)
        buffer += Self.uint32LE(UInt32(data.count))   // compressed size
        buffer += Self.uint32LE(UInt32(data.count))   // uncompressed size
        let nameBytes = Data(name.utf8)
        buffer += Self.uint16LE(UInt16(nameBytes.count))
        buffer += Self.uint16LE(0)            // extra field length
        buffer += nameBytes
        buffer += data

        entries.append(Entry(name: name, data: data, crc: crc, localHeaderOffset: offset))
    }

    func finalize() -> Data {
        var out = buffer
        let cdOffset = UInt32(out.count)

        for e in entries {
            let nameBytes = Data(e.name.utf8)
            out += Self.uint32LE(0x02014b50)  // central dir signature
            out += Self.uint16LE(20)           // version made by
            out += Self.uint16LE(20)           // version needed
            out += Self.uint16LE(0)            // general purpose bit flag
            out += Self.uint16LE(0)            // compression method: stored
            out += Self.uint16LE(0)            // last mod file time
            out += Self.uint16LE(0)            // last mod file date
            out += Self.uint32LE(e.crc)
            out += Self.uint32LE(UInt32(e.data.count))
            out += Self.uint32LE(UInt32(e.data.count))
            out += Self.uint16LE(UInt16(nameBytes.count))
            out += Self.uint16LE(0)            // extra field length
            out += Self.uint16LE(0)            // file comment length
            out += Self.uint16LE(0)            // disk number start
            out += Self.uint16LE(0)            // internal file attributes
            out += Self.uint32LE(0)            // external file attributes
            out += Self.uint32LE(e.localHeaderOffset)
            out += nameBytes
        }

        let cdSize   = UInt32(out.count) - cdOffset
        let count    = UInt16(entries.count)

        // End of central directory record
        out += Self.uint32LE(0x06054b50)
        out += Self.uint16LE(0)        // disk number
        out += Self.uint16LE(0)        // disk with start of CD
        out += Self.uint16LE(count)    // entries on disk
        out += Self.uint16LE(count)    // total entries
        out += Self.uint32LE(cdSize)
        out += Self.uint32LE(cdOffset)
        out += Self.uint16LE(0)        // comment length

        return out
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static func uint16LE(_ v: UInt16) -> Data {
        Data([UInt8(v & 0xFF), UInt8((v >> 8) & 0xFF)])
    }
    private static func uint32LE(_ v: UInt32) -> Data {
        Data([UInt8(v & 0xFF), UInt8((v >> 8) & 0xFF), UInt8((v >> 16) & 0xFF), UInt8((v >> 24) & 0xFF)])
    }

    static func crc32(_ data: Data) -> UInt32 {
        var crc: UInt32 = 0xFFFF_FFFF
        for byte in data {
            crc ^= UInt32(byte)
            for _ in 0..<8 {
                crc = (crc & 1) != 0 ? (crc >> 1) ^ 0xEDB8_8320 : crc >> 1
            }
        }
        return crc ^ 0xFFFF_FFFF
    }
}
