import AppIntents
import AVFoundation
import Core
import Foundation

/// Phase 1 probe: can a free-signed build record audio from a lock-screen
/// Control while the device is locked?
///
/// `AudioRecordingIntent` is a real App Intents protocol (iOS 18+, verified on
/// developer.apple.com). What is genuinely unknown — and what the spec asks to
/// find out before anything is built on top of it — is whether it survives
/// free signing and a locked screen. This records a fixed three seconds and
/// writes down what happened, so the app can report a fact instead of a guess.
///
/// Phase 5 replaces this with the real capture-and-parse flow.
struct ProbeRecordingIntent: AppIntent, AudioRecordingIntent {

    static let title: LocalizedStringResource = "Įrašyti kelionės prašymą"

    // The protocol requirement is `IntentDescription?`, so the type has to be
    // spelled out — an inferred `IntentDescription` does not satisfy it.
    static let description: IntentDescription? = IntentDescription(
        "Patikrina, ar iš užrakto ekrano galima įrašyti garsą."
    )

    /// Stay out of the app: the whole point is to prove recording works
    /// *without* unlocking and foregrounding.
    ///
    /// `supportedModes` rather than `openAppWhenRun`, which is deprecated.
    static let supportedModes: IntentModes = .background

    private static let probeSeconds: TimeInterval = 3

    func perform() async throws -> some IntentResult {
        // Not optional. Apple (developer.apple.com, AudioRecordingIntent):
        // "you must start a Live Activity when you begin the audio recording
        // and keep it active as long as you record audio. If you don't start
        // a Live Activity, the audio recording stops." The first version of
        // this probe did not, so it could only ever have failed. The banner
        // is left up afterwards: that is where the answer will appear.
        do {
            try TripActivityLauncher.start()
        } catch {
            LockScreenRecordingMarker.write(
                succeeded: false,
                seconds: 0,
                message: "baneris nepasileido: \(error)"
            )
            return .result()
        }

        do {
            let seconds = try await record(for: Self.probeSeconds)
            LockScreenRecordingMarker.write(
                succeeded: true,
                seconds: seconds,
                message: "OK"
            )
        } catch {
            LockScreenRecordingMarker.write(
                succeeded: false,
                seconds: 0,
                message: String(describing: error)
            )
        }
        return .result()
    }

    /// Records to a throwaway file and returns how long the file actually is.
    ///
    /// The *measured* length matters rather than the requested one: if iOS
    /// silently truncates or refuses recording while locked, a shorter file is
    /// the evidence.
    private func record(for duration: TimeInterval) async throws -> Double {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .default, options: [])
        try session.setActive(true, options: [])
        defer { try? session.setActive(false, options: [.notifyOthersOnDeactivation]) }

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("lockscreen-probe-\(UUID().uuidString).wav")

        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatLinearPCM),
            AVSampleRateKey: 16_000.0,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false,
        ]

        let recorder = try AVAudioRecorder(url: url, settings: settings)
        guard recorder.record() else {
            throw ProbeError.recorderRefused
        }

        try await Task.sleep(for: .seconds(duration))
        recorder.stop()

        let file = try AVAudioFile(forReading: url)
        let measured = Double(file.length) / file.fileFormat.sampleRate
        try? FileManager.default.removeItem(at: url)
        return measured
    }

    enum ProbeError: Error {
        case recorderRefused
    }
}
