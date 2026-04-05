import SwiftUI

struct ContentView: View {
    @EnvironmentObject var noteStore: NoteStore
    @State private var showSettings = false

    var body: some View {
        NavigationSplitView(columnVisibility: .constant(.all)) {
            NotesListView(showSettings: $showSettings)
        } detail: {
            if let note = noteStore.activeNote {
                NoteDetailView(note: note)
            } else {
                EmptyDetailView()
            }
        }
        .sheet(isPresented: $showSettings) {
            SettingsView()
        }
        .task {
            await noteStore.load()
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
