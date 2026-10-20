import SwiftUI

/// Every note reminder across the library, grouped like a reminders app.
struct RemindersView: View {
    @EnvironmentObject var noteStore: NoteStore
    @Binding var selectedTab: Int
    @State private var editing: Note?

    private enum Group: String, CaseIterable {
        case overdue = "Overdue", today = "Today", tomorrow = "Tomorrow", thisWeek = "This Week", later = "Later"
    }

    private func group(for date: Date, now: Date) -> Group {
        let cal = Calendar.current
        if date <= now { return .overdue }
        if cal.isDateInToday(date) { return .today }
        if cal.isDateInTomorrow(date) { return .tomorrow }
        if let weekOut = cal.date(byAdding: .day, value: 7, to: cal.startOfDay(for: now)), date < weekOut { return .thisWeek }
        return .later
    }

    /// Overdue reads most-recent first; the rest soonest first.
    private func ordered(_ rows: [(note: Note, date: Date)], group: Group) -> [(note: Note, date: Date)] {
        let sorted = rows.sorted { $0.date < $1.date }
        return group == .overdue ? sorted.reversed() : sorted
    }

    var body: some View {
        // Re-evaluate every minute so items roll into Overdue on time
        TimelineView(.periodic(from: .now, by: 60)) { context in
            let now = context.date
            let items = noteStore.upcomingReminders
            let grouped = Dictionary(grouping: items) { group(for: $0.date, now: now) }

            List {
                if items.isEmpty {
                    ContentUnavailableView(
                        "No Reminders",
                        systemImage: "bell.slash",
                        description: Text("Type /remind in a note to add one.")
                    )
                    .listRowBackground(Color.clear)
                }
                ForEach(Group.allCases, id: \.self) { g in
                    let rows = ordered(grouped[g] ?? [], group: g)
                    if !rows.isEmpty {
                        Section {
                            ForEach(rows, id: \.note.id) { item in
                                row(item.note, date: item.date, overdue: g == .overdue, now: now)
                            }
                        } header: {
                            Text(g.rawValue)
                                .foregroundStyle(g == .overdue ? Color.red : Color.secondary)
                        }
                    }
                }
            }
        }
        .navigationTitle("Reminders")
        .sheet(item: $editing) { note in
            ReminderPickerView(
                isPresented: Binding(get: { editing != nil }, set: { if !$0 { editing = nil } }),
                initialDate: note.reminder,
                onRemove: { Task { await noteStore.setReminder(nil, forNoteId: note.id) } }
            ) { date in
                Task { await noteStore.setReminder(date, forNoteId: note.id) }
            }
        }
        .refreshable { await noteStore.load() }
    }

    @ViewBuilder
    private func row(_ note: Note, date: Date, overdue: Bool, now: Date) -> some View {
        Button {
            Task {
                await noteStore.select(note)
                selectedTab = 0
            }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: overdue ? "bell.badge" : "bell")
                    .foregroundStyle(overdue ? Color.red : Color.accentColor)
                    .frame(width: 22)
                VStack(alignment: .leading, spacing: 2) {
                    Text(note.title.isEmpty ? "Untitled" : note.title)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    HStack(spacing: 4) {
                        Text(date.formatted(date: .abbreviated, time: .shortened))
                        Text("·")
                        Text(date, format: .relative(presentation: .named))
                    }
                    .font(.caption)
                    .foregroundStyle(overdue ? Color.red : Color.secondary)
                }
                Spacer()
            }
        }
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) {
                Task { await noteStore.setReminder(nil, forNoteId: note.id) }
            } label: {
                Label(overdue ? "Done" : "Remove", systemImage: overdue ? "checkmark" : "bell.slash")
            }
            Button {
                editing = note
            } label: {
                Label("Edit", systemImage: "calendar.badge.clock")
            }
            .tint(.accentColor)
        }
        .contextMenu {
            Button { editing = note } label: { Label("Edit Time", systemImage: "calendar.badge.clock") }
            Button(role: .destructive) {
                Task { await noteStore.setReminder(nil, forNoteId: note.id) }
            } label: { Label("Remove Reminder", systemImage: "bell.slash") }
        }
    }
}
