import SwiftUI

struct ContentView: View {
    @EnvironmentObject var noteStore: NoteStore
    @EnvironmentObject var reminderRouter: ReminderRouter
    @State private var showSettings = false
    @State private var selectedTab = 0
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        TabView(selection: $selectedTab) {
            notesTab
                .tabItem { Label("Notes", systemImage: "note.text") }
                .tag(0)

            NavigationStack {
                ExploreView(selectedTab: $selectedTab)
            }
            .tabItem { Label("Explore", systemImage: "circle.hexagongrid") }
            .tag(1)

            NavigationStack {
                RemindersView(selectedTab: $selectedTab)
            }
            .tabItem { Label("Reminders", systemImage: "bell") }
            .badge(noteStore.reminderBadgeCount)
            .tag(2)
        }
        .sheet(isPresented: $showSettings) {
            SettingsView()
        }
        .task {
            await noteStore.load()
        }
        // Open the note behind a tapped reminder — retried when notes finish
        // loading, since a cold launch delivers the tap before load() completes.
        .onChange(of: reminderRouter.pendingNoteId) { _, _ in openPendingReminderNote() }
        .onChange(of: noteStore.notes.count) { _, _ in openPendingReminderNote() }
    }

    private func openPendingReminderNote() {
        guard let id = reminderRouter.pendingNoteId else { return }
        Task {
            if await noteStore.openNote(id: id) {
                reminderRouter.pendingNoteId = nil
                selectedTab = 0
            }
        }
    }

    @ViewBuilder
    private var notesTab: some View {
        if sizeClass == .compact {
            NavigationStack {
                NotesListView(showSettings: $showSettings)
                    .navigationDestination(isPresented: Binding(
                        get: { noteStore.activeNote != nil },
                        set: { if !$0 { Task { await noteStore.deselect() } } }
                    )) {
                        if let note = noteStore.activeNote {
                            NoteDetailView(note: note)
                        }
                    }
            }
        } else {
            NavigationSplitView(columnVisibility: .constant(.all)) {
                NotesListView(showSettings: $showSettings)
            } detail: {
                if let note = noteStore.activeNote {
                    NoteDetailView(note: note)
                } else {
                    EmptyDetailView()
                }
            }
        }
    }
}

private struct EmptyDetailView: View {
    @EnvironmentObject var noteStore: NoteStore

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "note.text")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text("No note selected")
                .foregroundStyle(.secondary)
            Button("New Note") {
                Task { await noteStore.create() }
            }
            .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(backgroundGradient)
    }
}
