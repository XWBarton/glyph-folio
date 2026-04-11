import Foundation

struct Note: Identifiable, Codable, Equatable {
    let id: String          // filename stem, e.g. "2025-04-04-my-note"
    var title: String
    var body: String
    let createdAt: Date
    var modifiedAt: Date
    var filePath: URL

    static func == (lhs: Note, rhs: Note) -> Bool {
        lhs.id == rhs.id && lhs.title == rhs.title && lhs.modifiedAt == rhs.modifiedAt
    }

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

    var tags: [String] { Note.extractTags(from: body) }
    var links: [String] { Note.extractLinks(from: body) }

    // Parse tag lines — supports:
    //   // tags: foo, bar
    //   // @tags: foo, bar
    //   //tags: foo, bar
    static func extractTags(from body: String) -> [String] {
        for line in body.components(separatedBy: "\n") {
            guard let range = line.range(of: #"//\s*@?tags:\s*"#, options: .regularExpression) else { continue }
            let tagStr = String(line[range.upperBound...]).trimmingCharacters(in: .whitespaces)
            let tags = tagStr.components(separatedBy: ",")
                .map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
                .filter { !$0.isEmpty }
            if !tags.isEmpty { return tags }
        }
        return []
    }

    // Parse `[[link target]]` wikilinks
    static func extractLinks(from body: String) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: #"\[\[([^\]]+)\]\]"#) else { return [] }
        let ns = body as NSString
        return regex.matches(in: body, range: NSRange(location: 0, length: ns.length))
            .compactMap { match -> String? in
                guard match.numberOfRanges > 1 else { return nil }
                let r = match.range(at: 1)
                guard r.location != NSNotFound else { return nil }
                return ns.substring(with: r).trimmingCharacters(in: .whitespaces)
            }
    }

    static func extractTitle(from body: String, id: String) -> String {
        // Explicit override: // = Title (commented-out heading, not rendered in PDF)
        for line in body.components(separatedBy: "\n") {
            if let r = line.range(of: #"^//\s*=\s+(.+)$"#, options: .regularExpression) {
                let title = line[r].replacingOccurrences(of: #"^//\s*=\s+"#, with: "", options: .regularExpression)
                    .trimmingCharacters(in: .whitespaces)
                if !title.isEmpty { return title }
            }
        }
        // First Typst heading (= Title)
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
