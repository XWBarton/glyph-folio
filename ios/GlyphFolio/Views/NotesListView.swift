import SwiftUI
import UniformTypeIdentifiers

struct NotesListView: View {
    @EnvironmentObject var noteStore: NoteStore
    @Binding var showSettings: Bool
    @State private var searchText = ""
    @State private var noteToDelete: Note?
    @State private var showDeleteAlert = false
    @State private var showImporter = false

    private var filteredNotes: [Note] {
        guard !searchText.isEmpty else { return noteStore.notes }
        return noteStore.notes.filter {
            $0.title.localizedCaseInsensitiveContains(searchText) ||
            $0.body.localizedCaseInsensitiveContains(searchText)
        }
    }

    private var grouped: [(label: String, notes: [Note])] {
        groupNotes(filteredNotes)
    }

    var body: some View {
        List(selection: Binding(
            get: { noteStore.activeNote?.id },
            set: { id in
                if let id, let note = noteStore.notes.first(where: { $0.id == id }) {
                    Task { await noteStore.select(note) }
                }
            }
        )) {
            ForEach(grouped, id: \.label) { group in
                Section(group.label) {
                    ForEach(group.notes) { note in
                        NoteRowView(note: note, searchText: searchText)
                            .tag(note.id)
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                Button(role: .destructive) {
                                    noteToDelete = note
                                    showDeleteAlert = true
                                } label: {
                                    Image(systemName: "trash")
                                }
                                .tint(.red)
                            }
                    }
                }
            }
        }
        .refreshable { await noteStore.load() }
        .searchable(text: $searchText, prompt: "Search notes")
        .navigationTitle("Notes")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                Button {
                    showSettings = true
                } label: {
                    Image(systemName: "gear")
                }
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                HStack(spacing: 4) {
                    Button {
                        showImporter = true
                    } label: {
                        Image(systemName: "square.and.arrow.down")
                    }
                    Button {
                        Task { await noteStore.create() }
                    } label: {
                        Image(systemName: "square.and.pencil")
                    }
                }
            }
        }
        .fileImporter(
            isPresented: $showImporter,
            allowedContentTypes: [.data],
            allowsMultipleSelection: false
        ) { result in
            guard let url = try? result.get().first else { return }
            let ext = url.pathExtension.lowercased()
            guard ext == "glyph" || ext == "typ" else { return }
            Task { await noteStore.importNote(url: url) }
        }
        .alert("Delete Note?", isPresented: $showDeleteAlert, presenting: noteToDelete) { note in
            Button("Delete", role: .destructive) {
                Task { await noteStore.delete(note) }
            }
            Button("Cancel", role: .cancel) {}
        } message: { note in
            Text("\"\(note.title)\" will be permanently deleted.")
        }
        .scrollContentBackground(.hidden)
        .background(backgroundGradient)
        .safeAreaInset(edge: .top, spacing: 0) {
            if noteStore.syncMode == .server {
                SyncStatusBar(status: noteStore.syncStatus)
            }
        }
    }
}

private struct NoteRowView: View {
    let note: Note
    var searchText: String = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(note.title)
                .font(.system(size: 15, weight: .medium))
                .lineLimit(1)
            if let snippet = bodySnippet {
                Text(snippet)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            } else {
                Text(relativeTime(note.modifiedAt))
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }

    private var bodySnippet: String? {
        guard !searchText.isEmpty,
              !note.title.localizedCaseInsensitiveContains(searchText),
              let range = note.body.range(of: searchText, options: .caseInsensitive)
        else { return nil }

        let body = note.body
        let matchStart = range.lowerBound
        let matchEnd = range.upperBound
        let lo = body.index(matchStart, offsetBy: -40, limitedBy: body.startIndex) ?? body.startIndex
        let hi = body.index(matchEnd,   offsetBy:  60, limitedBy: body.endIndex)   ?? body.endIndex
        var excerpt = String(body[lo..<hi])
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "\n", with: " ")
        if lo > body.startIndex { excerpt = "…" + excerpt }
        if hi < body.endIndex   { excerpt = excerpt + "…" }
        return excerpt
    }
}

// ── Sync status bar ───────────────────────────────────────────────────────────

private struct SyncStatusBar: View {
    let status: SyncStatus

    var body: some View {
        HStack(spacing: 6) {
            Group {
                switch status {
                case .synced:
                    Image(systemName: "checkmark.icloud")
                        .foregroundStyle(.green)
                case .syncing:
                    ProgressView()
                        .scaleEffect(0.7)
                        .tint(.accentColor)
                case .offline:
                    Image(systemName: "icloud.slash")
                        .foregroundStyle(.orange)
                }
            }
            .frame(width: 16, height: 16)

            Text(statusLabel)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.vertical, 4)
        .background(.bar)
    }

    private var statusLabel: String {
        switch status {
        case .synced:  return "Synced"
        case .syncing: return "Syncing…"
        case .offline: return "Offline — changes saved locally"
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

private func groupNotes(_ notes: [Note]) -> [(label: String, notes: [Note])] {
    let cal = Calendar.current
    let now = Date()
    let todayStart   = cal.startOfDay(for: now)
    let yesterStart  = cal.date(byAdding: .day, value: -1, to: todayStart)!
    let weekStart    = cal.date(byAdding: .day, value: -6, to: todayStart)!
    let monthStart   = cal.date(byAdding: .day, value: -29, to: todayStart)!

    var today: [Note] = [], yesterday: [Note] = [], week: [Note] = [],
        month: [Note] = [], older: [Note] = []

    for note in notes {
        switch note.modifiedAt {
        case let d where d >= todayStart:   today.append(note)
        case let d where d >= yesterStart:  yesterday.append(note)
        case let d where d >= weekStart:    week.append(note)
        case let d where d >= monthStart:   month.append(note)
        default:                            older.append(note)
        }
    }

    return [
        ("Today",      today),
        ("Yesterday",  yesterday),
        ("This Week",  week),
        ("This Month", month),
        ("Older",      older),
    ].filter { !$0.1.isEmpty }
}

private func relativeTime(_ date: Date) -> String {
    let diff = Int(Date().timeIntervalSince(date))
    if diff < 60   { return "just now" }
    if diff < 3600 { return "\(diff / 60)m ago" }
    if diff < 86400 { return "\(diff / 3600)h ago" }
    if diff < 7 * 86400 { return "\(diff / 86400)d ago" }
    return date.formatted(date: .abbreviated, time: .omitted)
}
