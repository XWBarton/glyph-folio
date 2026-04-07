import SwiftUI

struct NoteDetailView: View {
    @EnvironmentObject var noteStore: NoteStore
    let note: Note
    @State private var showPreview = false
    @State private var pdfData: Data?
    @State private var pdfError: String?
    @State private var isCompiling = false
    @State private var shareItem: ShareableURL?
    @State private var isBusy = false
    @State private var showShareOptions = false

    var body: some View {
        NoteEditorView(note: note)
            .navigationTitle(liveTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    HStack(spacing: 6) {
                        if noteStore.syncMode == .server {
                            Circle()
                                .fill(syncDotColor)
                                .frame(width: 8, height: 8)
                        }
                        Text(liveTitle)
                            .font(.headline)
                    }
                }
                ToolbarItemGroup(placement: .navigationBarTrailing) {
                    if isBusy {
                        ProgressView().scaleEffect(0.8)
                    }
                    Button {
                        showShareOptions = true
                    } label: {
                        Image(systemName: "square.and.arrow.up")
                    }
                    .disabled(isBusy)
                    .confirmationDialog("Share", isPresented: $showShareOptions) {
                        Button("Export PDF") { Task { await requestPreview() } }
                        Button("Share Source") { Task { await requestShare() } }
                    }
                }
            }
            .sheet(item: $shareItem) { shareable in
                ShareSheet(url: shareable.url)
            }
            .sheet(isPresented: $showPreview) {
                if let pdfData {
                    PDFPreviewView(pdfData: pdfData, noteId: note.id)
                } else if let pdfError {
                    ErrorSheetView(message: pdfError)
                }
            }
    }

    // Always reads from the live activeNote so the title updates as the user types
    private var liveTitle: String {
        let t = noteStore.activeNote?.title ?? note.title
        return t.isEmpty ? "Note" : t
    }

    private var syncDotColor: Color {
        switch noteStore.syncStatus {
        case .synced:  return .green
        case .syncing: return .orange
        case .offline: return .red
        }
    }

    private func requestShare() async {
        await noteStore.flushPendingSave()
        guard let note = noteStore.activeNote ?? Optional(note) else { return }
        isBusy = true
        defer { isBusy = false }
        if let url = await noteStore.buildShareItem(for: note) {
            shareItem = ShareableURL(url: url)
        }
    }

    private func requestPreview() async {
        await noteStore.flushPendingSave()
        isBusy = true
        defer { isBusy = false }
        do {
            pdfData = try await noteStore.compilePDF()
            pdfError = nil
        } catch {
            pdfData = nil
            pdfError = error.localizedDescription
        }
        showPreview = true
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

struct ShareableURL: Identifiable {
    let id = UUID()
    let url: URL
}

struct ShareSheet: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}
