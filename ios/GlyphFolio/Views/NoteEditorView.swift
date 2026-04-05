import SwiftUI

struct NoteEditorView: View {
    @EnvironmentObject var noteStore: NoteStore
    let note: Note
    @State private var localBody: String = ""
    @FocusState private var editorFocused: Bool

    var body: some View {
        ScrollView {
            TextEditor(text: $localBody)
                .font(.system(.body, design: .monospaced))
                .focused($editorFocused)
                .frame(minHeight: UIScreen.main.bounds.height * 0.6)
                .scrollContentBackground(.hidden)
                .background(Color.clear)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .onChange(of: localBody) { _, newValue in
                    noteStore.updateBody(newValue)
                }
        }
        .background(backgroundGradient)
        .safeAreaInset(edge: .bottom) {
            FormatToolbar(onInsert: { text in
                localBody += text
            })
        }
        .onAppear {
            localBody = note.body
            editorFocused = true
        }
        .onChange(of: note.id) { _, _ in
            localBody = note.body
        }
    }
}

// ── Format toolbar ─────────────────────────────────────────────────────────────

private struct FormatToolbar: View {
    let onInsert: (String) -> Void

    private let actions: [(icon: String, label: String, text: String)] = [
        ("textformat.alt",      "H1",     "= "),
        ("textformat",          "H2",     "== "),
        ("bold",                "Bold",   "**"),
        ("italic",              "Italic", "_"),
        ("list.bullet",         "List",   "- "),
        ("list.number",         "Num",    "+ "),
        ("minus",               "Rule",   "\n---\n"),
        ("curlybraces",         "Code",   "`"),
    ]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(actions, id: \.label) { action in
                    Button {
                        onInsert(action.text)
                    } label: {
                        Image(systemName: action.icon)
                            .font(.system(size: 14))
                            .frame(width: 36, height: 36)
                            .background(.ultraThinMaterial)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    .foregroundStyle(.primary)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .background(.ultraThinMaterial)
    }
}
