import SwiftUI

// ── Buckets ──────────────────────────────────────────────────────────────────

struct MonthBucket: Identifiable {
    let id: String        // "2026-09" — stable identity across regenerations
    let label: String     // "Sep"
    let start: Date
    let end: Date
}

/// The last `count` calendar months, oldest first, including the current month.
func recentMonthBuckets(count: Int, calendar: Calendar = .current, now: Date = Date()) -> [MonthBucket] {
    guard let currentMonthStart = calendar.date(from: calendar.dateComponents([.year, .month], from: now)) else { return [] }
    let df = DateFormatter()
    df.dateFormat = "MMM"
    let idf = DateFormatter()
    idf.dateFormat = "yyyy-MM"

    var buckets: [MonthBucket] = []
    for i in stride(from: count - 1, through: 0, by: -1) {
        guard let start = calendar.date(byAdding: .month, value: -i, to: currentMonthStart),
              let end = calendar.date(byAdding: .month, value: 1, to: start) else { continue }
        buckets.append(MonthBucket(id: idf.string(from: start), label: df.string(from: start), start: start, end: end))
    }
    return buckets
}

/// notes.modifiedAt bucketed by tag × month — the two axes of the heatmap.
func heatmapCounts(notes: [Note], tags: [String], buckets: [MonthBucket]) -> [String: [Int]] {
    var result: [String: [Int]] = [:]
    for tag in tags {
        var counts = [Int](repeating: 0, count: buckets.count)
        for note in notes where note.tags.contains(tag) {
            if let idx = buckets.firstIndex(where: { note.modifiedAt >= $0.start && note.modifiedAt < $0.end }) {
                counts[idx] += 1
            }
        }
        result[tag] = counts
    }
    return result
}

// ── View ─────────────────────────────────────────────────────────────────────

/// A static tag-by-month activity grid — darker cells mean more notes with that
/// tag were touched that month. Intensity is scaled against the single hottest
/// cell in the whole grid, so tags stay comparable to each other (unlike scaling
/// each row to its own max, which would make a rarely-used tag look as "hot" as
/// a heavily-used one). Tapping a cell filters to that tag in the Tags list.
struct HeatmapView: View {
    let notes: [Note]
    let tags: [(tag: String, count: Int)]
    let onSelectTag: (String) -> Void

    @ObservedObject private var settings = AppSettings.shared
    private let monthsShown = 6
    private let labelWidth: CGFloat = 92

    private func color(for tag: String) -> Color {
        Color(hex: settings.tagColors[tag] ?? tagHashHex(tag))
    }

    var body: some View {
        // Computed once per render — `heatmapCounts` is O(tags × notes), so it must
        // not sit behind a computed property that SwiftUI re-evaluates on every
        // single cell access (that turned an O(tags × notes) pass into an
        // O(tags² × months × notes) one and froze the UI for anything but a
        // trivial vault).
        let sortedTags = tags.sorted { $0.count > $1.count }  // most-used first (top)
        let buckets = recentMonthBuckets(count: monthsShown)
        let counts = heatmapCounts(notes: notes, tags: sortedTags.map(\.tag), buckets: buckets)
        let maxCount = counts.values.flatMap { $0 }.max() ?? 1

        ScrollView {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 4) {
                    Color.clear.frame(width: labelWidth, height: 1)
                    ForEach(buckets) { bucket in
                        Text(bucket.label)
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity)
                    }
                }
                .padding(.horizontal)

                ForEach(sortedTags, id: \.tag) { item in
                    let rowCounts = counts[item.tag] ?? []
                    let tagColor = color(for: item.tag)
                    HStack(spacing: 4) {
                        Text(item.tag)
                            .font(.system(size: 13, weight: .medium))
                            .lineLimit(1)
                            .frame(width: labelWidth, alignment: .leading)
                        ForEach(Array(rowCounts.enumerated()), id: \.offset) { _, count in
                            let intensity = Double(count) / Double(maxCount)
                            Button {
                                onSelectTag(item.tag)
                            } label: {
                                RoundedRectangle(cornerRadius: 5)
                                    .fill(count == 0 ? Color.primary.opacity(0.05) : tagColor.opacity(0.25 + 0.65 * intensity))
                                    .frame(maxWidth: .infinity, minHeight: 28)
                                    .overlay {
                                        if count > 0 {
                                            Text("\(count)")
                                                .font(.system(size: 11, weight: .semibold))
                                                .foregroundStyle(intensity > 0.55 ? .white : Color.primary)
                                        }
                                    }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal)
                }
            }
            .padding(.vertical, 10)
        }
    }
}
