import Foundation

struct Note: Identifiable, Codable, Equatable {
    let id: String          // filename stem, e.g. "2025-04-04-my-note"
    var title: String
    var body: String
    let createdAt: Date
    var modifiedAt: Date
    var filePath: URL

    static func == (lhs: Note, rhs: Note) -> Bool { lhs.id == rhs.id }

    static func makeId(title: String?) -> String {
        let dateStr = ISO8601DateFormatter().string(from: Date()).prefix(10)
        let slug = (title ?? "note")
            .lowercased()
            .components(separatedBy: .alphanumerics.inverted)
            .joined(separator: "-")
            .components(separatedBy: "-")
            .filter { !$0.isEmpty }
            .prefix(8)
            .joined(separator: "-")
        return "\(dateStr)-\(slug.isEmpty ? "note" : slug)"
    }

    static func extractTitle(from body: String, id: String) -> String {
        if let match = body.range(of: #"^={1,6}\s+(.+)$"#, options: [.regularExpression, .anchored]) {
            let line = String(body[match])
            if let headingMatch = line.range(of: #"(?<=^={1,6}\s).+"#, options: .regularExpression) {
                return String(line[headingMatch]).trimmingCharacters(in: .whitespaces)
            }
        }
        // also try non-anchored first heading
        if let line = body.components(separatedBy: "\n").first(where: { $0.hasPrefix("=") }) {
            let title = line.drop(while: { $0 == "=" }).trimmingCharacters(in: .whitespaces)
            if !title.isEmpty { return title }
        }
        let clean = id
            .replacingOccurrences(of: #"^\d{4}-\d{2}-\d{2}-"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: "-", with: " ")
        return clean.isEmpty ? "Untitled" : clean.capitalized
    }
}
