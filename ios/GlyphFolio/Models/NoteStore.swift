import Foundation
import Combine
import UIKit

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
    private var lastSavedTitles: [String: String] = [:]

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
            // Seed lastSavedTitles so the first save after load won't trigger spurious renames
            for note in notes { lastSavedTitles[note.id] = note.title }
            // Seed tutorial note on first launch
            if notes.isEmpty && !UserDefaults.standard.bool(forKey: "tutorialSeeded") {
                await seedTutorialNote()
                UserDefaults.standard.set(true, forKey: "tutorialSeeded")
            }
        } catch {
            print("NoteStore.load error:", error)
            if syncMode == .server { syncStatus = .offline }
        }
        isLoading = false
    }

    private func seedTutorialNote() async {
        let now = Date()
        let datePart = now.formatted(.dateTime.month(.wide).day().year())
        let timePart = now.formatted(.dateTime.hour().minute())
        let dateLabel = "\(datePart) · \(timePart)"
        let id = Note.makeId(title: "getting-started")
        guard let dir = provider.notesDirectory() else { return }
        let url = dir.appendingPathComponent("\(id).typ")
        let body = tutorialNoteBody(dateLabel: dateLabel)
        let note = Note(
            id: id,
            title: "Getting Started",
            body: body,
            createdAt: now,
            modifiedAt: now,
            filePath: url
        )
        notes.insert(note, at: 0)
        lastSavedTitles[note.id] = note.title
        try? await provider.writeNote(note)
    }

    private func tutorialNoteBody(dateLabel: String) -> String {
        """
        // @tags: tutorial
        // = Getting Started
        #text(9pt, fill: gray)[\(dateLabel)]
        #line(length: 100%, stroke: 0.4pt + gray)

        Notes start with a tag string that is commented out:
        ```typst
        // @tags: testing, another-tag
        ```
        Glyph Folio will observe these tags for you to filter and visualise but will not be rendered in your note.

        #line(length: 100%)

        The note title will come from the first primary header but can be overridden by a commented primary header below the tag comment.

        ```typst
        // = Tutorial Note
        ```

        #line(length: 100%)

        The next two lines automatically insert the time and date of the note creation to the top of the note. It can be removed or edited if desired.

        ```typst
        #text(9pt, fill: gray)[\(dateLabel)]
        #line(length: 100%, stroke: 0.4pt + gray)
        ```

        #line(length: 100%)

        = Basic Typst Formatting
        \\
        #table(
          columns: (1fr, 1fr, 2fr),
          [*Symbol*], [*Function*], [*Note*],
          [`=`], [Header], [h1 is =, h2 is ==, h3 is === etc],
          [`*Glyph Folio*`], [Bold], [Wrap a word in a star to bold things],
          [`_Glyph Folio_`], [italicise], [Wrap a word in underscore to italicise things],
          [`-`], [Bullet lists], [],
          [`+`], [Ordered lists], [],
          [`//`], [Comment], [Text after this will not be rendered],
          [`\\`], [New line], [],
        )

        There are lots of things you can do, check out #text(fill: rgb("#0000EE"))[#link("https://typst.app/docs/reference/syntax/")[Typst]] for way more.

        = Glyph Folio Features

        == Extensions of Typst Syntax
        Use slash commands to quickly autofill many of these typst syntax features. Check it out type `/tab` and enter to fill a table format.
        \\
        \\
        Glyph Folio has a couple of extra / extended commands:
        - `/tag` will send your cursor to the tags at the top of the page so you can categorise your note and visualise in the graph view (described below)
        - Pressing `[[` will allow you to link another page which can also be visualised in the graph view (also described below)
        - `/check` will import the `cheq` typst module to give a pretty checkbox format
        - `/bookmark` will let you enter a URL and put a web bookmark and will pull the web page details and an image if it can.
        \\
        #block(stroke: 0.5pt + luma(215), radius: 6pt, inset: 10pt, width: 100%)[
          #link("https://typst.app/")[*Typst: The new foundation for documents*]\\
          #text(size: 9pt, fill: luma(110))[Typst is the new foundation for documents. Sign up now and experience limitless power to write, create, and automate anything that you can fit on a page.]\\
          #text(size: 8pt, fill: luma(160))[typst.app]
        ]
        - `/image` Fills the standard image format but if you are self-hosting will upload the image to a server path so the image can persist across devices.
        - While using `/table` to create a table, pressing enter / return after the last cell in your row will create a new row in your table

        == More on the Glyph Folio UI

        === Main Interface
        - The source is on the left pane and the rendered PDF is on the right
        - Clicking the arrows in the top right of the panes will make them full screen. Click again to go back to side by side
        - You can drag the centre column to resize the panes and double click to recentre
        - Pressing the settings button in the top right gives you options for server connect, dictionary and source colours
        - Export your rendered PDF or typst source with the share button. If there are images, they will be exported together in a .glyph directory

        === Explorer
        - Clicking the notes button or using `cmd+K` will open the explorer
        - You'll see the list view which give you:
            - A search box that can deep search note titles and content
            - A list of your tags that you can click to filter
            - A list of your most recently accessed notes in chronological order
        - You can then switch to graph view which will give you:
            - The graph with `link` lens on, this shows how each of your notes are connected by note links (`[[linked-note]]`)
            - You can then switch to the `tag` lens which will show how each of your notes are connected by shared tags
            - Clicking a node will take you to that note
        - `cmd+N` will open a new note
        - `cmd+1` will take you back to the last note you were on so you can quickly switch back and forth between two notes
        - `cmd+2` and `cmd+3` also work for your second and third last used notes
        - `cmd+R` will refresh the render
        - `cmd+F` Find and replace
        - `cmd+B` and `cmd+I` when highlighting text works to wrap words in *bold* or _italics_
        """
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
        let oldTitle = lastSavedTitles[n.id]
        let bgTask = UIApplication.shared.beginBackgroundTask(withName: "glyph-save") { }
        defer { UIApplication.shared.endBackgroundTask(bgTask) }
        do {
            try await provider.writeNote(n)
            if syncMode == .server { syncStatus = .synced }
            // Rename [[Old Title]] → [[New Title]] in all other notes if title changed
            if let old = oldTitle, old != n.title, !old.isEmpty, !n.title.isEmpty {
                await renameWikiLinks(from: old, to: n.title, excludingId: n.id)
            }
            lastSavedTitles[n.id] = n.title
        } catch {
            if syncMode == .server { syncStatus = .offline }
        }
        // Refresh sorted list
        if let idx = notes.firstIndex(where: { $0.id == n.id }) {
            notes[idx] = n
            notes.sort { $0.modifiedAt > $1.modifiedAt }
        }
    }

    private func renameWikiLinks(from oldTitle: String, to newTitle: String, excludingId: String) async {
        let needle = "[[\(oldTitle)]]"
        let replacement = "[[\(newTitle)]]"
        let candidates = notes.filter { $0.id != excludingId && $0.body.contains(needle) }
        guard !candidates.isEmpty else { return }
        let p = provider
        for var candidate in candidates {
            let newBody = candidate.body.replacingOccurrences(of: needle, with: replacement)
            candidate.body = newBody
            candidate.title = Note.extractTitle(from: newBody, id: candidate.id)
            try? await p.writeNote(candidate)
            if let idx = notes.firstIndex(where: { $0.id == candidate.id }) {
                notes[idx] = candidate
            }
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
        let bgTask = UIApplication.shared.beginBackgroundTask(withName: "glyph-upload") { }
        defer { UIApplication.shared.endBackgroundTask(bgTask) }
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

    // ── Import ────────────────────────────────────────────────────────────────

    func importNote(url: URL) async {
        guard url.startAccessingSecurityScopedResource() else { return }
        defer { url.stopAccessingSecurityScopedResource() }

        switch url.pathExtension.lowercased() {
        case "typ":  await importTypNote(url: url)
        case "glyph": await importGlyphBundle(url: url)
        default: break
        }
    }

    private func importTypNote(url: URL) async {
        guard let body = try? String(contentsOf: url, encoding: .utf8) else { return }
        let originalId = url.deletingPathExtension().lastPathComponent
        await createImportedNote(originalId: originalId, body: body, attachments: [:])
    }

    private func importGlyphBundle(url: URL) async {
        guard let reader = ZipReader(url: url) else { return }
        let allEntries = reader.entries()

        guard let typKey = allEntries.keys.first(where: { $0.hasSuffix(".typ") }),
              let typData = allEntries[typKey],
              let body = String(data: typData, encoding: .utf8) else { return }

        let originalId = String(typKey.dropLast(4)) // strip ".typ"
        let prefix = "attachments/\(originalId)/"
        var attachments: [String: Data] = [:]
        for (key, data) in allEntries where key.hasPrefix(prefix) {
            let filename = String(key.dropFirst(prefix.count))
            if !filename.isEmpty { attachments[filename] = data }
        }
        await createImportedNote(originalId: originalId, body: body, attachments: attachments)
    }

    private func createImportedNote(originalId: String, body: String, attachments: [String: Data]) async {
        let now = Date()
        let dateStr = ISO8601DateFormatter().string(from: now).prefix(10)
        let existingIds = Set(notes.map(\.id))

        // Keep original ID if available, otherwise generate a collision-safe one
        var id = originalId
        if existingIds.contains(id) {
            let slug = String(
                originalId.replacingOccurrences(of: "^\\d{4}-\\d{2}-\\d{2}-", with: "",
                    options: .regularExpression).prefix(40)
            )
            id = "\(dateStr)-\(slug)"
            var counter = 1
            while existingIds.contains(id) {
                id = "\(dateStr)-\(slug)-\(counter)"
                counter += 1
            }
        }

        // Rewrite attachment paths in body if ID changed
        var finalBody = body
        if id != originalId {
            finalBody = body.replacingOccurrences(
                of: "attachments/\(originalId)/",
                with: "attachments/\(id)/"
            )
        }

        let p = provider
        guard let dir = p.notesDirectory() else { return }
        let fileURL = dir.appendingPathComponent("\(id).typ")
        let note = Note(id: id, title: Note.extractTitle(from: finalBody, id: id),
                        body: finalBody, createdAt: now, modifiedAt: now, filePath: fileURL)

        notes.removeAll { $0.id == id }
        notes.insert(note, at: 0)
        activeNote = note
        lastSavedTitles[note.id] = note.title
        try? await p.writeNote(note)

        // Write attachments
        if !attachments.isEmpty {
            let attDir = dir.appendingPathComponent("attachments/\(id)", isDirectory: true)
            try? FileManager.default.createDirectory(at: attDir, withIntermediateDirectories: true)
            for (filename, data) in attachments {
                let dest = attDir.appendingPathComponent(filename)
                try? data.write(to: dest)
                // Also upload to server if in server mode
                if syncMode == .server {
                    _ = try? await p.uploadAttachment(noteId: id, filename: filename, data: data)
                }
            }
        }
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
