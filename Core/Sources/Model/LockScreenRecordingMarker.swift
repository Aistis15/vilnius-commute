import Foundation

/// What happened the last time the lock-screen Control tried to record.
///
/// The Control and the app may or may not run in the same process, and on a
/// free Apple ID they may or may not share an App Group container. That is
/// exactly what the Phase 1 probe is trying to find out, so this writes to
/// every container it can reach and reads from every container it can reach.
/// If the app cannot see a marker the Control definitely wrote, the two
/// processes have no shared storage — which is itself the result.
public struct LockScreenRecordingMarker: Codable, Sendable {
    public let date: Date
    public let succeeded: Bool
    public let seconds: Double
    public let message: String
    /// Which container it was written to, so the probe can report the path
    /// that actually worked.
    public let writtenTo: String

    public init(date: Date, succeeded: Bool, seconds: Double, message: String, writtenTo: String = "") {
        self.date = date
        self.succeeded = succeeded
        self.seconds = seconds
        self.message = message
        self.writtenTo = writtenTo
    }

    private static let fileName = "lockscreen-recording-probe.json"

    /// The App Group this build was compiled against, if any.
    /// Absent from the default build on purpose — see docs/capability-probe.md.
    public static var appGroupIdentifier: String? {
        Bundle.main.object(forInfoDictionaryKey: "VCAppGroupIdentifier") as? String
    }

    /// Every directory this process can legitimately write to, best first.
    static func candidateDirectories() -> [(label: String, url: URL)] {
        var out: [(String, URL)] = []
        if let group = appGroupIdentifier,
           let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) {
            out.append(("App Group", url))
        }
        if let support = try? FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask,
            appropriateFor: nil, create: true
        ) {
            out.append(("Application Support", support))
        }
        return out
    }

    /// Writes to every reachable container. Returns the labels written.
    @discardableResult
    public static func write(
        succeeded: Bool,
        seconds: Double,
        message: String,
        date: Date = .now
    ) -> [String] {
        var written: [String] = []
        for (label, dir) in candidateDirectories() {
            let marker = LockScreenRecordingMarker(
                date: date, succeeded: succeeded, seconds: seconds,
                message: message, writtenTo: label
            )
            guard let data = try? JSONEncoder().encode(marker) else { continue }
            let url = dir.appendingPathComponent(fileName)
            if (try? data.write(to: url, options: .atomic)) != nil {
                written.append(label)
            }
        }
        return written
    }

    /// Most recent marker across every reachable container.
    public static func read() -> LockScreenRecordingMarker? {
        candidateDirectories()
            .compactMap { _, dir -> LockScreenRecordingMarker? in
                let url = dir.appendingPathComponent(fileName)
                guard let data = try? Data(contentsOf: url) else { return nil }
                return try? JSONDecoder().decode(LockScreenRecordingMarker.self, from: data)
            }
            .max { $0.date < $1.date }
    }

    public static func clear() {
        for (_, dir) in candidateDirectories() {
            try? FileManager.default.removeItem(at: dir.appendingPathComponent(fileName))
        }
    }
}
