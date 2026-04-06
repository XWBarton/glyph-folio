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
        await flushPendingSave()
        let id = Note.makeId(title: title)
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
            .appendingPathComponent("GlyphFolio/local")
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
