import SwiftUI

@main
struct CollectRxApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .defaultSize(width: 1280, height: 820)
        .windowStyle(.titleBar)
        .windowToolbarStyle(.unified(showsTitle: true))
        .commands {
            CommandGroup(replacing: .newItem) { }
            CommandGroup(after: .appInfo) {
                Button("Reload command center") {
                    NotificationCenter.default.post(name: .collectRxReload, object: nil)
                }
                .keyboardShortcut("r", modifiers: [.command])
            }
        }

        Settings {
            SettingsView()
        }
    }
}

extension Notification.Name {
    static let collectRxReload = Notification.Name("CollectRxReload")
}

struct SettingsView: View {
    var body: some View {
        Form {
            Section("Command center") {
                LabeledContent("Server") {
                    Text(AppConfig.appOrigin)
                        .textSelection(.enabled)
                }
                Text("To override, set env COLLECTRX_APP_ORIGIN or create:")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text("~/Library/Application Support/CollectRx/app-origin.txt")
                    .font(.caption.monospaced())
                    .textSelection(.enabled)
            }
            Section("About") {
                LabeledContent("Product") { Text("CollectRx command center") }
                LabeledContent("Platform") { Text("Native macOS (Swift + WebKit)") }
            }
        }
        .formStyle(.grouped)
        .frame(width: 420, height: 260)
        .padding()
    }
}
