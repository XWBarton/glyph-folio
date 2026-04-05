import SwiftUI

struct NoteDetailView: View {
    @EnvironmentObject var noteStore: NoteStore
    let note: Note
    @State private var showPreview = false
    @State private var pdfData: Data?
    @State private var pdfError: String?
    @State private var isCompiling = false
    @State private var showExportSheet = false

    var body: some View {
        NoteEditorView(note: note)
            .navigationTitle(note.title.isEmpty ? "Note" : note.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItemGroup(placement: .navigationBarTrailing) {
                    if isCompiling {
                        ProgressView()
                            .scaleEffect(0.8)
                    }
                    Button {
                        Task { await requestPreview() }
                    } label: {
                        Image(systemName: "doc.richtext")
                    }
                }
            }
            .sheet(isPresented: $showPreview) {
                if let pdfData {
                    PDFPreviewView(pdfData: pdfData, noteId: note.id)
                } else if let pdfError {
                    ErrorSheetView(message: pdfError)
                }
            }
    }

    private func requestPreview() async {
        isCompiling = true
        defer { isCompiling = false }
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
