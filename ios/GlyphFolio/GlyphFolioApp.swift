import SwiftUI
import UserNotifications
import BackgroundTasks

// Show notifications even when the app is foregrounded
private class NotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler handler: @escaping (UNNotificationPresentationOptions) -> Void) {
        handler([.banner, .sound])
    }
}

private let reminderSyncTaskId = "com.glyph.folio.reminder-sync"

/// Schedule the next background reminder sync. Call this each time the app backgrounds
/// so iOS always has a pending request to wake the app.
func scheduleReminderSync() {
    let request = BGAppRefreshTaskRequest(identifier: reminderSyncTaskId)
    request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)  // no sooner than 15 min
    try? BGTaskScheduler.shared.submit(request)
}

/// Background task handler: sync notes and reschedule reminders, then schedule the next refresh.
private func handleReminderSyncTask(_ task: BGAppRefreshTask) {
    scheduleReminderSync()  // always re-queue before doing work

    let syncTask = Task { @MainActor in
        let store = NoteStore()
        await store.load()  // pulls latest notes (incl. any new // @reminder: lines) and reschedules
        task.setTaskCompleted(success: true)
    }

    task.expirationHandler = {
        syncTask.cancel()
        task.setTaskCompleted(success: false)
    }
}

@main
struct GlyphFolioApp: App {
    @StateObject private var noteStore = NoteStore()
    @Environment(\.scenePhase) private var scenePhase
    private let notificationDelegate = NotificationDelegate()

    init() {
        let center = UNUserNotificationCenter.current()
        center.delegate = notificationDelegate
        center.requestAuthorization(options: [.alert, .badge, .sound]) { _, _ in }

        // Register the background sync task — must happen before app finishes launching
        BGTaskScheduler.shared.register(forTaskWithIdentifier: reminderSyncTaskId, using: nil) { task in
            handleReminderSyncTask(task as! BGAppRefreshTask)
        }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(noteStore)
                .tint(Color(red: 0.145, green: 0.388, blue: 0.922)) // #2563eb
                .onChange(of: scenePhase) { _, phase in
                    if phase == .background {
                        scheduleReminderSync()
                    }
                }
                .onOpenURL { url in
                    if url.isFileURL {
                        // .glyph bundle or .typ file shared from another app
                        Task { await noteStore.importNote(url: url) }
                        return
                    }
                    guard url.scheme == "glyphfolio",
                          url.host == "add",
                          let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
                    else { return }
                    let params = Dictionary(
                        uniqueKeysWithValues: components.queryItems?
                            .compactMap { item -> (String, String)? in
                                guard let value = item.value else { return nil }
                                return (item.name, value)
                            } ?? []
                    )
                    let title = params["title"] ?? ""
                    let sourceURL = params["url"] ?? ""
                    let note = params["note"] ?? ""
                    Task {
                        await noteStore.createFromWebCapture(
                            title: title,
                            sourceURL: sourceURL,
                            note: note
                        )
                    }
                }
        }
    }
}
