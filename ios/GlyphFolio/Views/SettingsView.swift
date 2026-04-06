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
                }

                // ── Server settings ───────────────────────────────────────────
                if settings.syncMode == .server {
                    Section("Server") {
                        LabeledContent("URL") {
                            TextField("http://192.168.1.10:3001", text: $serverUrl)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .keyboardType(.URL)
                                .multilineTextAlignment(.trailing)
                                .onSubmit { settings.serverUrl = serverUrl }
                        }
                        LabeledContent("Auth Token") {
                            SecureField("Optional", text: $authToken)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .multilineTextAlignment(.trailing)
                                .onSubmit { settings.authToken = authToken }
                        }
                        Button {
                            Task { await testConnection() }
                        } label: {
                            if testStatus == .testing {
                                HStack {
                                    ProgressView().scaleEffect(0.8)
                                    Text("Testing…")
                                }
                            } else if testStatus == .ok {
                                Label("Connected", systemImage: "checkmark.circle.fill")
                                    .foregroundStyle(.green)
                            } else if testStatus == .fail {
                                Label(testMessage, systemImage: "xmark.circle.fill")
                                    .foregroundStyle(.red)
                            } else {
                                Text("Test Connection")
                            }
                        }
                        .disabled(testStatus == .testing)
                    }
                } else {
                    Section {
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
