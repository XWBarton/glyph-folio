import Foundation
import Combine

@MainActor
class NoteStore: ObservableObject {
    @Published var notes: [Note] = []
    @Published var activeNote: Note?
    @Published var isLoading = false
    @Published var syncMode: AppSettings.SyncMode = AppSettings.shared.syncMode

    private var provider: SyncProvider { makeProvider() }
    private var autoSaveTask: Task<Void, Never>?
    private var pendingBody: String?

    private func makeProvider() -> SyncProvider {
        switch AppSettings.shared.syncMode {
        case .server: return ServerSyncProvider(serverUrl: AppSettings.shared.serverUrl)
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
        } catch {
            print("NoteStore.load error:", error)
        }
        isLoading = false
    }

    // ── Select ───────────────────────────────────────────────────────────────

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
        await flushPendingSave()
        let id = Note.makeId(title: title)
        let heading = title.map { "= \($0)\n\n" } ?? ""
        let now = Date()
        guard let dir = provider.notesDirectory() else { return }
        let url = dir.appendingPathComponent("\(id).typ")
        let note = Note(
            id: id,
            title: title ?? "New Note",
            body: heading,
            createdAt: now,
            modifiedAt: now,
            filePath: url
        )
        try? await provider.writeNote(note)
        await load()
        activeNote = notes.first { $0.id == id } ?? note
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
        try? await provider.writeNote(n)
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
        if activeNote?.id == note.id {
            await flushPendingSave()
            activeNote = nil
        }
        try? await provider.deleteNote(id: note.id)
        notes.removeAll { $0.id == note.id }
        if activeNote == nil, let first = notes.first {
            await select(first)
        }
    }

    // ── PDF compilation ───────────────────────────────────────────────────────

    func compilePDF() async throws -> Data {
        guard let note = activeNote else { throw SyncError.fileError("No note selected") }
        return try await provider.compilePDF(note: note)
    }

    // ── Reload settings ───────────────────────────────────────────────────────

    func reloadSettings() async {
        syncMode = AppSettings.shared.syncMode
        await load()
    }
}

// ── Local provider (no sync) ─────────────────────────────────────────────────

private class LocalSyncProvider: SyncProvider {
    private var dir: URL {
        let d = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("GlyphFolio")
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    func notesDirectory() -> URL? { dir }

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
}
