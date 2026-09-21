import SwiftUI

// ── Matrix ───────────────────────────────────────────────────────────────────

/// Pairwise co-occurrence counts: matrix[i][j] = number of notes carrying both
/// tags[i] and tags[j] (the diagonal is simply that tag's own note count).
func coTagMatrix(notes: [Note], tags: [String]) -> [[Int]] {
    var matrix = [[Int]](repeating: [Int](repeating: 0, count: tags.count), count: tags.count)
    for note in notes {
        let noteTags = Set(note.tags)
        let present = tags.indices.filter { noteTags.contains(tags[$0]) }
        for i in present {
            for j in present { matrix[i][j] += 1 }
        }
    }
    return matrix
}

/// Largest off-diagonal value in the matrix — the busiest tag *pairing*, used to
/// scale co-occurrence cell intensity independently of the (usually much larger)
/// diagonal.
func maxOffDiagonal(_ matrix: [[Int]]) -> Int {
    var m = 0
    for i in matrix.indices {
        for j in matrix.indices where i != j { m = max(m, matrix[i][j]) }
    }
    return max(m, 1)
}

// ── View ─────────────────────────────────────────────────────────────────────

/// A static tag × tag grid — cell shade shows how often two tags co-occur.
/// The diagonal (a tag against itself) is shaded in that tag's own color at a
/// fixed intensity so it reads as "this tag's total," while off-diagonal cells
/// are scaled against the busiest *pairing* rather than the diagonal, since the
/// diagonal is usually much larger than any pair and would otherwise wash out
/// every real co-occurrence to near-invisible. Tapping a cell filters the Tags
/// list to that tag (diagonal) or to notes carrying both tags (off-diagonal).
struct CoTagMatrixView: View {
    let notes: [Note]
    let tags: [(tag: String, count: Int)]
    let onSelectPair: (String, String) -> Void

    @ObservedObject private var settings = AppSettings.shared
    private let cellSize: CGFloat = 34
    private let labelWidth: CGFloat = 92

    private func hex(for tag: String) -> String {
        settings.tagColors[tag] ?? tagHashHex(tag)
    }

    var body: some View {
        // Computed once per render, not per cell: `coTagMatrix` is O(notes × tags²),
        // and `matrix`/`maxOffDiagonal` were previously computed properties that
        // SwiftUI re-evaluated on every one of the N² cell accesses — an O(N²) matrix
        // rebuild for every single cell (and `maxOffDiagonal` did that N² times over,
        // once per pair it scanned), which froze the UI for anything past a handful
        // of tags.
        // Rows and columns both sorted most-used-first, so the busiest tag's own
        // diagonal cell sits at the top-left corner, fading toward the bottom-right.
        let rowNames = tags.sorted { $0.count > $1.count }.map(\.tag)
        let matrix = coTagMatrix(notes: notes, tags: rowNames)
        let indexOf = Dictionary(uniqueKeysWithValues: rowNames.enumerated().map { ($1, $0) })
        let maxPair = maxOffDiagonal(matrix)

        ScrollView([.horizontal, .vertical]) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 2) {
                    Color.clear.frame(width: labelWidth, height: 1)
                    ForEach(rowNames, id: \.self) { tag in
                        Text(String(tag.prefix(4)))
                            .font(.system(size: 9, weight: .medium))
                            .foregroundStyle(Color(hex: hex(for: tag)))
                            .frame(width: cellSize)
                            .lineLimit(1)
                    }
                }

                ForEach(rowNames, id: \.self) { rowTag in
                    HStack(spacing: 2) {
                        Text(rowTag)
                            .font(.system(size: 12, weight: .medium))
                            .lineLimit(1)
                            .frame(width: labelWidth, alignment: .leading)
                        ForEach(rowNames, id: \.self) { colTag in
                            Button {
                                onSelectPair(rowTag, colTag)
                            } label: {
                                cell(rowTag: rowTag, colTag: colTag, indexOf: indexOf, matrix: matrix, maxPair: maxPair)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .padding()
        }
    }

    @ViewBuilder
    private func cell(rowTag: String, colTag: String, indexOf: [String: Int], matrix: [[Int]], maxPair: Int) -> some View {
        let i = indexOf[rowTag] ?? 0
        let j = indexOf[colTag] ?? 0
        let count = matrix[i][j]
        let isDiagonal = rowTag == colTag
        let color: Color = isDiagonal
            ? Color(hex: hex(for: rowTag))
            : blendHex(hex(for: rowTag), hex(for: colTag))
        let intensity = isDiagonal ? 0.3 : (count == 0 ? 0 : 0.2 + 0.7 * Double(count) / Double(maxPair))
        RoundedRectangle(cornerRadius: 4)
            .fill(count == 0 && !isDiagonal ? Color.primary.opacity(0.04) : color.opacity(intensity))
            .frame(width: cellSize, height: cellSize)
            .overlay {
                if count > 0 {
                    Text("\(count)")
                        .font(.system(size: 10, weight: isDiagonal ? .bold : .medium))
                        .foregroundStyle(intensity > 0.55 ? .white : Color.primary)
                }
            }
    }
}
