import Foundation
import Combine

enum SyncStatus {
    case synced, syncing, offline
}

@MainActor
class NoteStore: ObservableObject {
    @Published var notes: [Note] = []
    @Published var activeNote: Note?
    @Published var isLoading = false
    @Published var syncMode: AppSettings.SyncMode = AppSettings.shared.syncMode
    @Published var syncStatus: SyncStatus = .synced

    private var provider: SyncProvider { makeProvider() }
    private var autoSaveTask: Task<Void, Never>?
    private var pendingBody: String?

    private func makeProvider() -> SyncProvider {
        switch AppSettings.shared.syncMode {
        case .server: return ServerSyncProvider(serverUrl: AppSettings.shared.serverUrl, authToken: AppSettings.shared.authToken)
        case .local:  return LocalSyncProvider()
        // Uncomment when iCloud entitlement is available (paid Apple Developer account):
        // case .icloud: return ICloudSyncProvider()
        }
    }

    // ── Load ─────────────────────────────────────────────────────────────────

    func load() async {
        isLoading = true
        do {
            notes = try await provider.listNotes()
            if syncMode == .server { syncStatus = .synced }
        } catch {
            print("NoteStore.load error:", error)
            if syncMode == .server { syncStatus = .offline }
        }
        isLoading = false
    }

    // ── Select ───────────────────────────────────────────────────────────────

    func deselect() async {
        await flushPendingSave()
        activeNote = nil
    }

    func select(_ note: Note) async {
        // Flush any pending save before switching
        await flushPendingSave()
        if let fresh = try? await provider.readNote(id: note.id) {
            activeNote = fresh
        } else {
            activeNote = note
        }
    }

    // ── Create ───────────────────────────────────────────────────────────────

    func create(title: String? = nil) async {
        // Capture pending save state synchronously before any async work so
        // we can flush the old note in the background while navigating immediately.
        let staleNote = activeNote
        let staleBody = pendingBody
        autoSaveTask?.cancel()
        pendingBody = nil

        // Avoid filename collisions (e.g. multiple "New Note" taps on the same day)
        let baseId = Note.makeId(title: title)
        let existingIds = Set(notes.map(\.id))
        var id = baseId
        var counter = 1
        while existingIds.contains(id) {
            id = "\(baseId)-\(counter)"
            counter += 1
        }
        let noteTitle = title ?? "New Note"
        let now = Date()
        let datePart = now.formatted(.dateTime.month(.wide).day().year())
        let timePart = now.formatted(.dateTime.hour().minute())
        let dateLabel = "\(datePart) · \(timePart)"
        let body = [
            "// @tags: ",
            "#text(9pt, fill: gray)[\(dateLabel)]",
            "#line(length: 100%, stroke: 0.4pt + gray)",
            "",
            "= \(noteTitle)",
            "",
            "",
        ].joined(separator: "\n")
        guard let dir = provider.notesDirectory() else { return }
        let url = dir.appendingPathComponent("\(id).typ")
        let note = Note(
            id: id,
            title: noteTitle,
            body: body,
            createdAt: now,
            modifiedAt: now,
            filePath: url
        )

        // Navigate immediately — insert into list and open the note before any I/O
        notes.removeAll { $0.id == id }
        notes.insert(note, at: 0)
        activeNote = note

        // Flush old note + write new note to disk/server in the background
        let p = provider
        Task {
            if var n = staleNote, let pending = staleBody {
                n.body = pending
                n.modifiedAt = Date()
                try? await p.writeNote(n)
            }
            try? await p.writeNote(note)
        }
    }

    // ── Update body (debounced auto-save) ─────────────────────────────────────

    func updateBody(_ body: String) {
        guard var note = activeNote else { return }
        note.body = body
        note.title = Note.extractTitle(from: body, id: note.id)
        note.modifiedAt = Date()
        activeNote = note
        // Update in list for live sidebar title refresh
        if let idx = notes.firstIndex(where: { $0.id == note.id }) {
            notes[idx] = note
        }
        pendingBody = body
        if syncMode == .server { syncStatus = .syncing }
        scheduleSave(note: note)
    }

    private func scheduleSave(note: Note) {
        autoSaveTask?.cancel()
        autoSaveTask = Task {
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled else { return }
            await save(note)
        }
    }

    private func save(_ note: Note) async {
        guard var n = activeNote, n.id == note.id else { return }
        if let pending = pendingBody { n.body = pending; pendingBody = nil }
        do {
            try await provider.writeNote(n)
            if syncMode == .server { syncStatus = .synced }
        } catch {
            if syncMode == .server { syncStatus = .offline }
        }
        // Refresh sorted list
        if let idx = notes.firstIndex(where: { $0.id == n.id }) {
            notes[idx] = n
            notes.sort { $0.modifiedAt > $1.modifiedAt }
        }
    }

    func flushPendingSave() async {
        autoSaveTask?.cancel()
        if let note = activeNote, pendingBody != nil {
            await save(note)
        }
        pendingBody = nil
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    func delete(_ note: Note) async {
        // Optimistic removal — UI updates immediately
        notes.removeAll { $0.id == note.id }
        if activeNote?.id == note.id {
            autoSaveTask?.cancel()
            pendingBody = nil
            activeNote = nil
        }
        try? await provider.deleteNote(id: note.id)
    }

    // ── PDF compilation ───────────────────────────────────────────────────────

    func compilePDF() async throws -> Data {
        guard let note = activeNote else { throw SyncError.fileError("No note selected") }
        return try await provider.compilePDF(note: note)
    }

    // ── Attachments ───────────────────────────────────────────────────────────

    /// Upload an image to the sync provider. Returns the sanitised filename stored by the server.
    func uploadAttachment(noteId: String, filename: String, data: Data) async throws -> String {
        return try await provider.uploadAttachment(noteId: noteId, filename: filename, data: data)
    }

    // ── Share source ──────────────────────────────────────────────────────────

    /// Build a shareable item for the note: a bare .typ URL when no attachments
    /// are referenced, or a .glyph zip bundle when there are.
    func buildShareItem(for note: Note) async -> URL? {
        let body = note.body

        // Find all attachment filenames referenced in the body
        let pattern = #"image\("attachments/[^/]+/([^"]+)"\)"#
        let regex = try? NSRegularExpression(pattern: pattern)
        let ns = body as NSString
        let referenced: [String] = (regex?.matches(in: body, range: NSRange(location: 0, length: ns.length)) ?? [])
            .compactMap { m -> String? in
                guard m.numberOfRanges > 1 else { return nil }
                return ns.substring(with: m.range(at: 1))
            }

        let tmpDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("glyph-share-\(note.id)", isDirectory: true)
        try? FileManager.default.createDirectory(at: tmpDir, withIntermediateDirectories: true)

        // Always write a fresh .typ from current in-memory body
        let typURL = tmpDir.appendingPathComponent("\(note.id).typ")
        guard (try? body.write(to: typURL, atomically: true, encoding: .utf8)) != nil else { return nil }

        guard !referenced.isEmpty else {
            return typURL  // no attachments → share the .typ directly
        }

        // Build a .glyph zip bundle
        var zip = ZipArchive()
        zip.add(name: "\(note.id).typ", data: Data(body.utf8))

        for filename in referenced {
            let attachData: Data?
            do {
                attachData = try await provider.downloadAttachment(noteId: note.id, filename: filename)
            } catch {
                attachData = nil
            }
            if let d = attachData {
                zip.add(name: "attachments/\(note.id)/\(filename)", data: d)
            }
        }

        let bundleURL = tmpDir.appendingPathComponent("\(note.id).glyph")
        let zipData = zip.finalize()
        guard (try? zipData.write(to: bundleURL)) != nil else { return nil }
        return bundleURL
    }

    // ── Reload settings ───────────────────────────────────────────────────────

    func reloadSettings() async {
        syncMode = AppSettings.shared.syncMode
        await load()
    }
}

// ── Local provider (no sync) ─────────────────────────────────────────────────

private actor LocalSyncProvider: SyncProvider {
    nonisolated private var dir: URL {
        let d = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("GlyphFolio/local")
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    nonisolated func notesDirectory() -> URL? { dir }

    func listNotes() async throws -> [Note] {
        let contents = (try? FileManager.default.contentsOfDirectory(
            at: dir, includingPropertiesForKeys: [.contentModificationDateKey, .creationDateKey]
        )) ?? []
        return contents.filter { $0.pathExtension == "typ" }.compactMap { url in
            let id = url.deletingPathExtension().lastPathComponent
            let body = (try? String(contentsOf: url)) ?? ""
            let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
            let modifiedAt = (attrs?[.modificationDate] as? Date) ?? Date()
            let createdAt  = (attrs?[.creationDate]     as? Date) ?? modifiedAt
            return Note(id: id, title: Note.extractTitle(from: body, id: id),
                        body: body, createdAt: createdAt, modifiedAt: modifiedAt, filePath: url)
        }.sorted { $0.modifiedAt > $1.modifiedAt }
    }

    func readNote(id: String) async throws -> Note? {
        let url = dir.appendingPathComponent("\(id).typ")
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let body = (try? String(contentsOf: url)) ?? ""
        let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
        let modifiedAt = (attrs?[.modificationDate] as? Date) ?? Date()
        let createdAt  = (attrs?[.creationDate]     as? Date) ?? modifiedAt
        return Note(id: id, title: Note.extractTitle(from: body, id: id),
                    body: body, createdAt: createdAt, modifiedAt: modifiedAt, filePath: url)
    }

    func writeNote(_ note: Note) async throws {
        try note.body.write(to: dir.appendingPathComponent("\(note.id).typ"), atomically: true, encoding: .utf8)
    }

    func deleteNote(id: String) async throws {
        let url = dir.appendingPathComponent("\(id).typ")
        try? FileManager.default.removeItem(at: url)
    }

    func compilePDF(note: Note) async throws -> Data {
        throw SyncError.pdfNotAvailable("PDF export requires server mode. Switch to Server in Settings.")
    }

    func listAttachments(noteId: String) async throws -> [String] { [] }
    func uploadAttachment(noteId: String, filename: String, data: Data) async throws -> String {
        throw SyncError.networkError("Attachments require server mode.")
    }
    func downloadAttachment(noteId: String, filename: String) async throws -> Data {
        throw SyncError.networkError("Attachments require server mode.")
    }
    func deleteAttachment(noteId: String, filename: String) async throws {}
}
