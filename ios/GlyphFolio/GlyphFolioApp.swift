import SwiftUI

@main
struct GlyphFolioApp: App {
    @StateObject private var noteStore = NoteStore()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(noteStore)
                .tint(Color(red: 0.145, green: 0.388, blue: 0.922)) // #2563eb
        }
    }
}
