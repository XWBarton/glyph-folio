import Foundation

/// Reads/writes .typ files in iCloud Drive → Documents/GlyphFolio/
/// Uses NSFileCoordinator for safe concurrent access and NSMetadataQuery
/// to enumerate files that may not yet be locally downloaded.
class ICloudSyncProvider: SyncProvider {

    // ── Directory ────────────────────────────────────────────────────────────

    func notesDirectory() -> URL? {
        guard let base = FileManager.default.url(
            forUbiquityContainerIdentifier: "iCloud.com.glyph.folio"
        ) else { return nil }
        let dir = base.appendingPathComponent("Documents/GlyphFolio", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    // ── List notes via NSMetadataQuery ───────────────────────────────────────

    func listNotes() async throws -> [Note] {
        guard let dir = notesDirectory() else { throw SyncError.fileError("iCloud not available") }

        // Trigger download of any undownloaded stubs
        let contents = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [
            .ubiquitousItemIsDownloadingKey,
            .contentModificationDateKey,
            .creationDateKey
        ])) ?? []

        return try contents
            .filter { $0.pathExtension == "typ" }
            .compactMap { url -> Note? in
                try? FileManager.default.startDownloadingUbiquitousItem(at: url)
                return try readFromURL(url)
            }
            .sorted { $0.modifiedAt > $1.modifiedAt }
    }

    // ── Read ─────────────────────────────────────────────────────────────────

    func readNote(id: String) async throws -> Note? {
        guard let dir = notesDirectory() else { return nil }
        let url = dir.appendingPathComponent("\(id).typ")
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return try readFromURL(url)
    }

    private func readFromURL(_ url: URL) throws -> Note {
        var body = ""
        var error: NSError?
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &error) { coordinated in
            body = (try? String(contentsOf: coordinated, encoding: .utf8)) ?? ""
        }
        if let error { throw error }

        let id = url.deletingPathExtension().lastPathComponent
        let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
        let modifiedAt = (attrs?[.modificationDate] as? Date) ?? Date()
        let createdAt: Date = {
            if let prefix = id.prefix(10).components(separatedBy: "-").count == 3
                ? id.prefix(10).description : nil,
               let d = ISO8601DateFormatter().date(from: "\(prefix)T00:00:00Z") {
                return d
            }
            return (attrs?[.creationDate] as? Date) ?? modifiedAt
        }()

        return Note(
            id: id,
            title: Note.extractTitle(from: body, id: id),
            body: body,
            createdAt: createdAt,
            modifiedAt: modifiedAt,
            filePath: url
        )
    }

    // ── Write ────────────────────────────────────────────────────────────────

    func writeNote(_ note: Note) async throws {
        guard let dir = notesDirectory() else { throw SyncError.fileError("iCloud not available") }
        let url = dir.appendingPathComponent("\(note.id).typ")
        var writeError: NSError?
        NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &writeError) { coordinated in
            try? note.body.write(to: coordinated, atomically: true, encoding: .utf8)
        }
        if let writeError { throw writeError }
    }

    // ── Delete ───────────────────────────────────────────────────────────────

    func deleteNote(id: String) async throws {
        guard let dir = notesDirectory() else { return }
        let url = dir.appendingPathComponent("\(id).typ")
        var deleteError: NSError?
        NSFileCoordinator().coordinate(writingItemAt: url, options: .forDeleting, error: &deleteError) { coordinated in
            try? FileManager.default.removeItem(at: coordinated)
        }
        if let deleteError { throw deleteError }
    }

    // ── PDF compilation ──────────────────────────────────────────────────────

    func compilePDF(note: Note) async throws -> Data {
        throw SyncError.pdfNotAvailable(
            "PDF export requires the sync server. Switch to Server mode in Settings."
        )
    }
}
