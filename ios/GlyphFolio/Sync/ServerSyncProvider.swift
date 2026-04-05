import Foundation

/// Syncs with the Glyph Folio sync server via REST.
/// Notes are also stored locally in Documents/GlyphFolio/ as a cache.
class ServerSyncProvider: SyncProvider {
    private let serverUrl: String

    init(serverUrl: String) {
        self.serverUrl = serverUrl.trimmingCharacters(in: .init(charactersIn: "/"))
    }

    // ── Local cache directory ────────────────────────────────────────────────

    func notesDirectory() -> URL? {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("GlyphFolio", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    // ── List ─────────────────────────────────────────────────────────────────

    func listNotes() async throws -> [Note] {
        guard let url = URL(string: "\(serverUrl)/api/notes") else {
            throw SyncError.networkError("Invalid server URL")
        }
        let (data, _) = try await URLSession.shared.data(from: url)
        let metas = try JSONDecoder().decode([NoteMetaDTO].self, from: data)

        // Pull notes and sync to local cache
        return try await withThrowingTaskGroup(of: Note?.self) { group in
            for meta in metas {
                group.addTask { try await self.readNote(id: meta.id) }
            }
            var notes: [Note] = []
            for try await note in group { if let n = note { notes.append(n) } }
            return notes.sorted { $0.modifiedAt > $1.modifiedAt }
        }
    }

    // ── Read ─────────────────────────────────────────────────────────────────

    func readNote(id: String) async throws -> Note? {
        guard let url = URL(string: "\(serverUrl)/api/notes/\(id)") else { return nil }
        let (data, response) = try await URLSession.shared.data(from: url)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }

        let dto = try JSONDecoder().decode(NoteDTO.self, from: data)
        let cacheURL = notesDirectory()?.appendingPathComponent("\(id).typ")

        // Write to local cache
        if let cacheURL { try? dto.body.write(to: cacheURL, atomically: true, encoding: .utf8) }

        let df = ISO8601DateFormatter()
        df.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let modifiedAt = df.date(from: dto.modifiedAt) ?? Date()
        let createdAt: Date = {
            let prefix = id.prefix(10).description
            return df.date(from: "\(prefix)T00:00:00Z") ?? modifiedAt
        }()

        return Note(
            id: id,
            title: Note.extractTitle(from: dto.body, id: id),
            body: dto.body,
            createdAt: createdAt,
            modifiedAt: modifiedAt,
            filePath: cacheURL ?? URL(fileURLWithPath: id)
        )
    }

    // ── Write ────────────────────────────────────────────────────────────────

    func writeNote(_ note: Note) async throws {
        // Write locally first
        if let cacheURL = notesDirectory()?.appendingPathComponent("\(note.id).typ") {
            try? note.body.write(to: cacheURL, atomically: true, encoding: .utf8)
        }

        guard let url = URL(string: "\(serverUrl)/api/notes/\(note.id)") else {
            throw SyncError.networkError("Invalid server URL")
        }
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["body": note.body])
        let (_, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw SyncError.networkError("Server returned error on write")
        }
    }

    // ── Delete ───────────────────────────────────────────────────────────────

    func deleteNote(id: String) async throws {
        // Remove local cache
        if let cacheURL = notesDirectory()?.appendingPathComponent("\(id).typ") {
            try? FileManager.default.removeItem(at: cacheURL)
        }

        guard let url = URL(string: "\(serverUrl)/api/notes/\(id)") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        _ = try? await URLSession.shared.data(for: request)
    }

    // ── PDF compilation ──────────────────────────────────────────────────────

    func compilePDF(note: Note) async throws -> Data {
        guard let url = URL(string: "\(serverUrl)/api/compile") else {
            throw SyncError.networkError("Invalid server URL")
        }

        let dateStr = DateFormatter.localizedString(from: note.createdAt, dateStyle: .long, timeStyle: .none)
        let safeTitle = note.title
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "[", with: "\\[")
            .replacingOccurrences(of: "]", with: "\\]")

        let content = """
        #set page(margin: 2cm)
        #set text(font: "New Computer Modern", size: 11pt)
        #set heading(numbering: none)

        #align(center)[
          #text(size: 18pt, weight: "bold")[\(safeTitle)]
          #v(0.4em)
          #text(size: 10pt, fill: gray)[\(dateStr)]
        ]

        #v(0.8em)
        #line(length: 100%, stroke: 0.5pt + gray)
        #v(0.8em)

        \(note.body)
        """

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["content": content, "noteId": note.id])

        let (data, _) = try await URLSession.shared.data(for: request)
        struct CompileResponse: Decodable {
            let ok: Bool
            let pdfBase64: String?
            let error: String?
        }
        let response = try JSONDecoder().decode(CompileResponse.self, from: data)
        guard response.ok, let b64 = response.pdfBase64,
              let pdfData = Data(base64Encoded: b64) else {
            throw SyncError.networkError(response.error ?? "Compilation failed")
        }
        return pdfData
    }
}

// ── DTOs ─────────────────────────────────────────────────────────────────────

private struct NoteMetaDTO: Decodable {
    let id: String
    let title: String
    let modifiedAt: String
}

private struct NoteDTO: Decodable {
    let id: String
    let title: String
    let body: String
    let modifiedAt: String
}
