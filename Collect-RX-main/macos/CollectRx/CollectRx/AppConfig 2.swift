import Foundation

enum AppConfig {
    /// Production command center (Fly.io, Toronto).
    static let defaultOrigin = "https://collect-rx.fly.dev"

    /// Override via `COLLECTRX_APP_ORIGIN` env or `~/Library/Application Support/CollectRx/app-origin.txt`.
    static var appOrigin: String {
        if let env = ProcessInfo.processInfo.environment["COLLECTRX_APP_ORIGIN"]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !env.isEmpty,
           let _ = URL(string: env) {
            return env.replacingOccurrences(of: "/$", with: "", options: .regularExpression)
        }
        if let fromFile = readOriginFile(), !fromFile.isEmpty {
            return fromFile
        }
        return defaultOrigin
    }

    static var loginURL: URL {
        URL(string: "\(appOrigin)/login")!
    }

    static var allowedHosts: Set<String> {
        var hosts: Set<String> = ["collect-rx.fly.dev", "collectrx.ca", "www.collectrx.ca", "app.collectrx.ca"]
        if let host = URL(string: appOrigin)?.host {
            hosts.insert(host)
        }
        return hosts
    }

    private static func readOriginFile() -> String? {
        let url = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent("CollectRx", isDirectory: true)
            .appendingPathComponent("app-origin.txt")
        guard let url, let raw = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        let line = raw
            .split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .first { !$0.isEmpty && !$0.hasPrefix("#") }
        guard let line, line.hasPrefix("http") else { return nil }
        return line.replacingOccurrences(of: "/$", with: "", options: .regularExpression)
    }
}
