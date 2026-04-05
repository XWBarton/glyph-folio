import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var noteStore: NoteStore
    @ObservedObject var settings = AppSettings.shared
    @Environment(\.dismiss) private var dismiss

    @State private var serverUrl: String = AppSettings.shared.serverUrl
    @State private var authToken: String = AppSettings.shared.authToken
    @State private var testStatus: TestStatus = .idle
    @State private var testMessage = ""

    enum TestStatus { case idle, testing, ok, fail }

    var body: some View {
        NavigationStack {
            Form {
                // ── Sync mode ────────────────────────────────────────────────
                Section("Sync Mode") {
                    Picker("Mode", selection: $settings.syncMode) {
                        ForEach(AppSettings.SyncMode.allCases, id: \.self) { mode in
                            Text(mode.displayName).tag(mode)
                        }
                    }
                    .pickerStyle(.segmented)
                    .listRowInsets(.init())
                    .listRowBackground(Color.clear)

                    switch settings.syncMode {
                    case .server:
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Server URL")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            TextField("http://192.168.1.10:3001", text: $serverUrl)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .keyboardType(.URL)
                                .onSubmit { settings.serverUrl = serverUrl }

                            Text("Auth Token")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            SecureField("Optional bearer token", text: $authToken)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .onSubmit { settings.authToken = authToken }

                            HStack {
                                Button("Test Connection") {
                                    Task { await testConnection() }
                                }
                                .disabled(testStatus == .testing)

                                if testStatus != .idle {
                                    Label(testMessage, systemImage: testStatus == .ok ? "checkmark.circle.fill" : "xmark.circle.fill")
                                        .font(.caption)
                                        .foregroundStyle(testStatus == .ok ? .green : .red)
                                }
                            }
                        }
                    case .local:
                        Label("Notes stored locally on this device only.", systemImage: "iphone")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                }

                // ── About ────────────────────────────────────────────────────
                Section("About") {
                    HStack {
                        Text("Glyph Folio")
                        Spacer()
                        Text("0.1.0").foregroundStyle(.secondary)
                    }
                    Text("A sibling to Glyph and Glyph Quorum — quick Typst note-taking with PDF export.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
            }
            .scrollContentBackground(.hidden)
            .background(backgroundGradient)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") {
                        settings.serverUrl = serverUrl
                        settings.authToken = authToken
                        Task { await noteStore.reloadSettings() }
                        dismiss()
                    }
                    .fontWeight(.semibold)
                }
            }
        }
    }

    private func testConnection() async {
        testStatus = .testing
        testMessage = "Testing…"
        let urlStr = serverUrl.trimmingCharacters(in: .init(charactersIn: "/")) + "/api/health"
        guard let url = URL(string: urlStr) else {
            testStatus = .fail; testMessage = "Invalid URL"; return
        }
        do {
            var req = URLRequest(url: url)
            if !authToken.isEmpty { req.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization") }
            let (_, response) = try await URLSession.shared.data(for: req)
            if (response as? HTTPURLResponse)?.statusCode == 200 {
                testStatus = .ok;   testMessage = "Connected"
            } else {
                testStatus = .fail; testMessage = "Server error"
            }
        } catch {
            testStatus = .fail; testMessage = "Unreachable"
        }
    }
}
