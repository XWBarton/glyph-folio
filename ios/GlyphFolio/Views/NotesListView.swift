import SwiftUI

struct NotesListView: View {
    @EnvironmentObject var noteStore: NoteStore
    @Binding var showSettings: Bool
    @State private var searchText = ""
    @State private var noteToDelete: Note?
    @State private var showDeleteAlert = false

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
                        NoteRowView(note: note)
                            .tag(note.id)
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                Button(role: .destructive) {
                                    noteToDelete = note
                                    showDeleteAlert = true
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                    }
                }
            }
        }
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
                Button {
                    Task { await noteStore.create() }
                } label: {
                    Image(systemName: "square.and.pencil")
                }
            }
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
    }
}

private struct NoteRowView: View {
    let note: Note

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(note.title)
                .font(.system(size: 15, weight: .medium))
                .lineLimit(1)
            Text(relativeTime(note.modifiedAt))
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
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
