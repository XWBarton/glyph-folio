import SwiftUI

struct ExploreView: View {
    @EnvironmentObject var noteStore: NoteStore
    @Binding var selectedTab: Int
    @State private var mode = 0          // 0 = Tags, 1 = Graph
    @State private var selectedTag: String? = nil

    private var allTags: [(tag: String, count: Int)] {
        var counts: [String: Int] = [:]
        for note in noteStore.notes {
            for tag in note.tags { counts[tag, default: 0] += 1 }
        }
        return counts.sorted { $0.key < $1.key }.map { ($0.key, $0.value) }
    }

    private var filteredNotes: [Note] {
        guard let tag = selectedTag else { return noteStore.notes }
        return noteStore.notes.filter { $0.tags.contains(tag) }
    }

    var body: some View {
        VStack(spacing: 0) {
            Picker("Mode", selection: $mode) {
                Text("Tags").tag(0)
                Text("Graph").tag(1)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .padding(.vertical, 10)

            if mode == 0 {
                tagsView
            } else {
                graphView
            }
        }
        .navigationTitle("Explore")
        .navigationBarTitleDisplayMode(.large)
        .background(backgroundGradient)
        .scrollContentBackground(.hidden)
    }

    // ── Tags mode ─────────────────────────────────────────────────────────────

    @ViewBuilder
    private var tagsView: some View {
        if allTags.isEmpty {
            emptyTagsPlaceholder
        } else {
            VStack(spacing: 0) {
                // Tag pills
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        TagPill(label: "All", count: noteStore.notes.count,
                                selected: selectedTag == nil) {
                            selectedTag = nil
                        }
                        ForEach(allTags, id: \.tag) { item in
                            TagPill(label: item.tag, count: item.count,
                                    selected: selectedTag == item.tag) {
                                selectedTag = selectedTag == item.tag ? nil : item.tag
                            }
                        }
                    }
                    .padding(.horizontal)
                    .padding(.vertical, 8)
                }

                Divider()

                ExploreNoteList(notes: filteredNotes) { note in
                    Task { await noteStore.select(note) }
                    selectedTab = 0
                }
            }
        }
    }

    private var emptyTagsPlaceholder: some View {
        VStack(spacing: 12) {
            Spacer()
            Image(systemName: "tag")
                .font(.system(size: 40))
                .foregroundStyle(.secondary)
            Text("No tags yet")
                .foregroundStyle(.secondary)
            Text("Add `// tags: foo, bar` to any note")
                .font(.callout)
                .foregroundStyle(.tertiary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Spacer()
        }
    }

    // ── Graph mode ────────────────────────────────────────────────────────────

    @ViewBuilder
    private var graphView: some View {
        if noteStore.notes.isEmpty {
            VStack(spacing: 12) {
                Spacer()
                Image(systemName: "circle.hexagongrid")
                    .font(.system(size: 40))
                    .foregroundStyle(.secondary)
                Text("No notes to graph")
                    .foregroundStyle(.secondary)
                Spacer()
            }
        } else {
            GraphView(notes: noteStore.notes) { note in
                Task { await noteStore.select(note) }
                selectedTab = 0
            }
        }
    }
}

// ── Tag pill ──────────────────────────────────────────────────────────────────

private struct TagPill: View {
    let label: String
    let count: Int
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Text(label)
                    .font(.system(size: 13, weight: .medium))
                Text("\(count)")
                    .font(.system(size: 11))
                    .foregroundStyle(selected ? .white.opacity(0.75) : .secondary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(selected ? Color.accentColor : Color.secondary.opacity(0.15))
            .foregroundStyle(selected ? .white : .primary)
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}

// ── Extracted to give the compiler clear type context ─────────────────────────

private struct ExploreNoteList: View {
    let notes: [Note]
    let onSelect: (Note) -> Void

    var body: some View {
        List {
            ForEach(notes.indices, id: \.self) { i in
                ExploreNoteRow(note: notes[i], onSelect: onSelect)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
    }
}

private struct ExploreNoteRow: View {
    let note: Note
    let onSelect: (Note) -> Void

    var body: some View {
        let tags = note.tags
        Button { onSelect(note) } label: {
            VStack(alignment: .leading, spacing: 3) {
                Text(note.title)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                if !tags.isEmpty {
                    Text(tags.map { "#\($0)" }.joined(separator: "  "))
                        .font(.system(size: 11))
                        .foregroundStyle(.tint)
                }
            }
            .padding(.vertical, 2)
        }
    }
}
