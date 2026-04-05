import Foundation
import Combine

class AppSettings: ObservableObject {
    static let shared = AppSettings()

    @Published var syncMode: SyncMode {
        didSet { UserDefaults.standard.set(syncMode.rawValue, forKey: "syncMode") }
    }
    @Published var serverUrl: String {
        didSet { UserDefaults.standard.set(serverUrl, forKey: "serverUrl") }
    }

    enum SyncMode: String, CaseIterable {
        case local  = "local"
        case server = "server"
        // iCloud requires a paid Apple Developer account (ubiquity-container entitlement).
        // Re-add `case icloud = "icloud"` and restore project.yml entitlements to enable it.

        var displayName: String {
            switch self {
            case .local:  return "Local"
            case .server: return "Server"
            }
        }
    }

    private init() {
        let rawMode = UserDefaults.standard.string(forKey: "syncMode") ?? "local"
        // If a previous build stored "icloud", fall back to local.
        self.syncMode  = SyncMode(rawValue: rawMode) ?? .local
        self.serverUrl = UserDefaults.standard.string(forKey: "serverUrl") ?? ""
    }
}
