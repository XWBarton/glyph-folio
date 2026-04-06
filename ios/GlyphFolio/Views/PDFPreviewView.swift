import SwiftUI
import WebKit

/// Displays a compiled PDF in a WKWebView using a data: URL.
struct PDFPreviewView: View {
    let pdfData: Data
    let noteId: String
    @Environment(\.dismiss) private var dismiss
    @State private var shareItem: ShareItem?

    var body: some View {
        NavigationStack {
            PDFWebView(pdfData: pdfData)
                .ignoresSafeArea(edges: .bottom)
                .navigationTitle("Preview")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .navigationBarLeading) {
                        Button("Done") { dismiss() }
                    }
                    ToolbarItem(placement: .navigationBarTrailing) {
                        Button {
                            shareItem = ShareItem(data: pdfData, filename: "\(noteId).pdf")
                        } label: {
                            Image(systemName: "square.and.arrow.up")
                        }
                    }
                }
                .sheet(item: $shareItem) { item in
                    ShareSheet(url: item.url)
                }
        }
    }
}

// ── WKWebView wrapper ─────────────────────────────────────────────────────────

private struct PDFWebView: UIViewRepresentable {
    let pdfData: Data

    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView()
        webView.backgroundColor = .systemBackground
        let b64 = pdfData.base64EncodedString()
        let html = """
        <html><body style="margin:0;padding:0;background:#fff;">
        <embed src="data:application/pdf;base64,\(b64)"
               type="application/pdf" width="100%" height="100%"/>
        </body></html>
        """
        webView.loadHTMLString(html, baseURL: nil)
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

// ── Share helpers ─────────────────────────────────────────────────────────────

private struct ShareItem: Identifiable {
    let id = UUID()
    let data: Data
    let filename: String

    var url: URL {
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
        try? data.write(to: tmp)
        return tmp
    }
}

// ── Error sheet ───────────────────────────────────────────────────────────────

struct ErrorSheetView: View {
    let message: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Image(systemName: "exclamationmark.triangle")
                    .font(.system(size: 40))
                    .foregroundStyle(.orange)
                Text(message)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(backgroundGradient)
            .navigationTitle("Cannot Export")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}
