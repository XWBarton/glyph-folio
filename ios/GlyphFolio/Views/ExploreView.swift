import SwiftUI

struct ExploreView: View {
    @EnvironmentObject var noteStore: NoteStore
    @Binding var selectedTab: Int
    @ObservedObject private var settings = AppSettings.shared
    @State private var mode = 0          // 0 = Tags, 1 = Heatmap, 2 = Matrix
    @State private var selectedTag: String? = nil
    @State private var selectedTag2: String? = nil
    @State private var colorPickerTag: String? = nil

    private var allTags: [(tag: String, count: Int)] {
        var counts: [String: Int] = [:]
        for note in noteStore.notes {
            for tag in note.tags { counts[tag, default: 0] += 1 }
        }
        return counts.sorted { $0.key < $1.key }.map { ($0.key, $0.value) }
    }

    private var filteredNotes: [Note] {
        noteStore.notes.filter { note in
            (selectedTag == nil || note.tags.contains(selectedTag!))
                && (selectedTag2 == nil || note.tags.contains(selectedTag2!))
        }
    }

    /// Filters to a single tag — used by Clusters and the tag-pill row.
    private func filter(toTag tag: String?) {
        selectedTag = tag
        selectedTag2 = nil
    }

    /// Filters to notes carrying both tags — used by the co-tag matrix's off-diagonal cells.
    private func filter(toTagPair a: String, _ b: String) {
        selectedTag = a
        selectedTag2 = b
    }

    var body: some View {
        VStack(spacing: 0) {
            Picker("Mode", selection: $mode) {
                Text("Tags").tag(0)
                Text("Heatmap").tag(1)
                Text("Matrix").tag(2)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .padding(.vertical, 10)

            switch mode {
            case 0: tagsView
            case 1: heatmapView
            default: matrixView
            }
        }
        .navigationTitle("Explore")
        .navigationBarTitleDisplayMode(.large)
        .background(backgroundGradient)
        .scrollContentBackground(.hidden)
        .sheet(isPresented: Binding(
            get: { colorPickerTag != nil },
            set: { if !$0 { colorPickerTag = nil } }
        )) {
            if let tag = colorPickerTag {
                TagColorPickerSheet(
                    tag: tag,
                    current: settings.tagColors[tag],
                    onPick: { hex in
                        var colors = settings.tagColors
                        colors[tag] = hex
                        settings.tagColors = colors
                        colorPickerTag = nil
                    },
                    onReset: {
                        var colors = settings.tagColors
                        colors.removeValue(forKey: tag)
                        settings.tagColors = colors
                        colorPickerTag = nil
                    }
                )
                .presentationDetents([.height(260)])
                .presentationDragIndicator(.visible)
            }
        }
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
                            filter(toTag: nil)
                        }
                        ForEach(allTags, id: \.tag) { item in
                            TagPill(label: item.tag, count: item.count,
                                    selected: selectedTag == item.tag && selectedTag2 == nil,
                                    color: settings.tagColors[item.tag].map(Color.init(hex:)) ?? tagHashColor(item.tag)) {
                                filter(toTag: selectedTag == item.tag && selectedTag2 == nil ? nil : item.tag)
                            }
                            .simultaneousGesture(
                                LongPressGesture().onEnded { _ in colorPickerTag = item.tag }
                            )
                        }
                    }
                    .padding(.horizontal)
                    .padding(.vertical, 8)
                }

                if let tag2 = selectedTag2, let tag1 = selectedTag {
                    HStack(spacing: 6) {
                        Text("Showing notes tagged both #\(tag1) and #\(tag2)")
                            .font(.system(size: 12))
                            .foregroundStyle(.secondary)
                        Spacer()
                        Button("Clear") { filter(toTag: nil) }
                            .font(.system(size: 12, weight: .medium))
                    }
                    .padding(.horizontal)
                    .padding(.bottom, 6)
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

    // ── Heatmap mode ──────────────────────────────────────────────────────────

    @ViewBuilder
    private var heatmapView: some View {
        if allTags.isEmpty {
            emptyTagsPlaceholder
        } else {
            HeatmapView(notes: noteStore.notes, tags: allTags) { tag in
                filter(toTag: tag)
                mode = 0
            }
        }
    }

    // ── Matrix mode ───────────────────────────────────────────────────────────

    @ViewBuilder
    private var matrixView: some View {
        if allTags.isEmpty {
            emptyTagsPlaceholder
        } else {
            CoTagMatrixView(notes: noteStore.notes, tags: allTags) { a, b in
                if a == b {
                    filter(toTag: a)
                } else {
                    filter(toTagPair: a, b)
                }
                mode = 0
            }
        }
    }
}

// ── Tag pill ──────────────────────────────────────────────────────────────────

private struct TagPill: View {
    let label: String
    let count: Int
    let selected: Bool
    var color: Color = .glyphAccent
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Circle()
                    .fill(color)
                    .frame(width: 7, height: 7)
                Text(label)
                    .font(.system(size: 13, weight: .medium))
                Text("\(count)")
                    .font(.system(size: 11))
                    .foregroundStyle(selected ? .white.opacity(0.75) : .secondary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(selected ? color : color.opacity(0.12))
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
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
    }
}

private struct ExploreNoteRow: View {
    let note: Note
    let onSelect: (Note) -> Void
    @ObservedObject private var settings = AppSettings.shared

    var body: some View {
        let tags = note.tags
        Button { onSelect(note) } label: {
            VStack(alignment: .leading, spacing: 3) {
                Text(note.title)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                if !tags.isEmpty {
                    HStack(spacing: 4) {
                        ForEach(tags, id: \.self) { tag in
                            let c: Color = settings.tagColors[tag].map(Color.init(hex:)) ?? tagHashColor(tag)
                            Circle().fill(c).frame(width: 7, height: 7)
                            Text("#\(tag)")
                                .font(.system(size: 11))
                                .foregroundStyle(c)
                        }
                    }
                }
            }
            .padding(.vertical, 2)
        }
    }
}

// ── Tag color picker sheet ────────────────────────────────────────────────────

private struct TagColorPickerSheet: View {
    let tag: String
    let current: String?
    let onPick: (String) -> Void
    let onReset: () -> Void

    let columns = Array(repeating: GridItem(.flexible(), spacing: 12), count: 6)

    var body: some View {
        VStack(spacing: 16) {
            Text("#\(tag)")
                .font(.system(size: 16, weight: .semibold))
                .padding(.top, 20)

            LazyVGrid(columns: columns, spacing: 12) {
                ForEach(tagColorPalette, id: \.self) { hex in
                    let isSelected = current == hex
                    Button {
                        onPick(hex)
                    } label: {
                        ZStack {
                            Circle().fill(Color(hex: hex))
                            if isSelected {
                                Circle().strokeBorder(.white, lineWidth: 2.5)
                                Image(systemName: "checkmark")
                                    .font(.system(size: 10, weight: .bold))
                                    .foregroundStyle(.white)
                            }
                        }
                        .frame(width: 40, height: 40)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 24)

            if current != nil {
                Button("Reset to default", role: .destructive, action: onReset)
                    .font(.system(size: 13))
            }

            Spacer()
        }
    }
}
