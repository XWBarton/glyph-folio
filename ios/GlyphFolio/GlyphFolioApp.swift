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

private let refreshTaskId   = "com.glyph.folio.reminder-sync"       // BGAppRefreshTask
private let processingTaskId = "com.glyph.folio.reminder-process"    // BGProcessingTask

/// Schedule both background task types. iOS treats them independently, so
/// registering both gives the scheduler more opportunities to fire our sync.
/// `earliestBeginDate` is a lower bound — iOS decides the actual cadence based
/// on how often the user opens the app, power state, and network conditions.
func scheduleReminderSync() {
    let refresh = BGAppRefreshTaskRequest(identifier: refreshTaskId)
    refresh.earliestBeginDate = Date(timeIntervalSinceNow: 10 * 60)  // aim for ~10 min
    try? BGTaskScheduler.shared.submit(refresh)

    let processing = BGProcessingTaskRequest(identifier: processingTaskId)
    processing.earliestBeginDate = Date(timeIntervalSinceNow: 10 * 60)
    processing.requiresNetworkConnectivity = true
    processing.requiresExternalPower = false
    try? BGTaskScheduler.shared.submit(processing)
}

/// Shared body for both task types: pull latest notes (which reschedules any
/// reminders), then always re-queue so iOS has something to wake us for next.
private func handleBackgroundSync(_ task: BGTask) {
    scheduleReminderSync()

    let syncTask = Task { @MainActor in
        let store = NoteStore()
        await store.load()
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

        // Register both background task handlers — must happen before the app
        // finishes launching. If iOS fires the handler, we sync and re-queue.
        BGTaskScheduler.shared.register(forTaskWithIdentifier: refreshTaskId, using: nil) { task in
            handleBackgroundSync(task)
        }
        BGTaskScheduler.shared.register(forTaskWithIdentifier: processingTaskId, using: nil) { task in
            handleBackgroundSync(task)
        }

        // Queue the first background sync at launch so iOS has a pending
        // request even if the user hasn't backgrounded the app yet.
        scheduleReminderSync()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(noteStore)
                .tint(Color(red: 0.145, green: 0.388, blue: 0.922)) // #2563eb
                .onChange(of: scenePhase) { _, phase in
                    switch phase {
                    case .background:
                        scheduleReminderSync()
                    case .active:
                        // On foreground: pull latest notes (picks up reminders
                        // set on other devices) and re-check permission status.
                        Task {
                            await noteStore.refreshNotificationAuth()
                            await noteStore.load()
                        }
                    default:
                        break
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
