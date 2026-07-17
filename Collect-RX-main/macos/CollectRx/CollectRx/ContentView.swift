import SwiftUI

struct ContentView: View {
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var reloadToken = 0

    var body: some View {
        ZStack {
            Color(red: 0.94, green: 0.93, blue: 0.89)
                .ignoresSafeArea()

            CommandCenterWebView(
                initialURL: AppConfig.loginURL,
                isLoading: $isLoading,
                errorMessage: $errorMessage,
                onReload: { reloadToken += 1 }
            )
            .id(reloadToken)
            .ignoresSafeArea()

            if isLoading && errorMessage == nil {
                VStack(spacing: 12) {
                    ProgressView()
                        .controlSize(.regular)
                    Text("Loading CollectRx…")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .padding(24)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
            }

            if let errorMessage {
                VStack(spacing: 16) {
                    Image(systemName: "wifi.exclamationmark")
                        .font(.system(size: 36))
                        .foregroundStyle(.secondary)
                    Text("Could not reach CollectRx")
                        .font(.headline)
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 320)
                    Text(AppConfig.appOrigin)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                    Button("Try again") {
                        self.errorMessage = nil
                        reloadToken += 1
                    }
                    .keyboardShortcut(.defaultAction)
                }
                .padding(32)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
            }
        }
        .frame(minWidth: 960, minHeight: 600)
        .onReceive(NotificationCenter.default.publisher(for: .collectRxReload)) { _ in
            errorMessage = nil
            reloadToken += 1
        }
        .toolbar {
            ToolbarItemGroup(placement: .navigation) {
                Button {
                    reloadToken += 1
                } label: {
                    Label("Reload", systemImage: "arrow.clockwise")
                }
                .help("Reload command center")
            }
            ToolbarItemGroup(placement: .primaryAction) {
                Button {
                    if let url = URL(string: AppConfig.appOrigin) {
                        NSWorkspace.shared.open(url)
                    }
                } label: {
                    Label("Open in browser", systemImage: "safari")
                }
                .help("Open in your default browser")
            }
        }
    }
}

#Preview {
    ContentView()
        .frame(width: 1100, height: 700)
}
