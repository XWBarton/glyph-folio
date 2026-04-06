import Foundation

protocol SyncProvider {
    func notesDirectory() -> URL?
    func listNotes() async throws -> [Note]
    func readNote(id: String) async throws -> Note?
    func writeNote(_ note: Note) async throws
    func deleteNote(id: String) async throws
    /// Returns PDF data. Throws SyncError.pdfNotAvailable if unsupported.
    func compilePDF(note: Note) async throws -> Data

    // ── Attachments ───────────────────────────────────────────────────────────
    func listAttachments(noteId: String) async throws -> [String]
    func uploadAttachment(noteId: String, filename: String, data: Data) async throws -> String
    func downloadAttachment(noteId: String, filename: String) async throws -> Data
    func deleteAttachment(noteId: String, filename: String) async throws
}

enum SyncError: LocalizedError {
    case pdfNotAvailable(String)
    case fileError(String)
    case networkError(String)

    var errorDescription: String? {
        switch self {
        case .pdfNotAvailable(let msg): return msg
        case .fileError(let msg):       return msg
        case .networkError(let msg):    return msg
        }
    }
}
