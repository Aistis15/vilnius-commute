import AVFoundation
import Foundation
import Observation

/// Records 16 kHz mono PCM — the only format whisper.cpp accepts.
///
/// `AVAudioRecorder` writing a WAV at the target rate is used rather than an
/// `AVAudioEngine` tap: the engine route would need a sample-rate converter
/// and a real-time-safe ring buffer, and neither earns its keep when the
/// recording is a short utterance that is transcribed after the fact.
@MainActor
@Observable
final class AudioRecorder {

    enum State: Equatable {
        case idle
        case recording
        case failed(String)
    }

    private(set) var state: State = .idle
    private(set) var lastRecordingURL: URL?
    private(set) var lastDuration: TimeInterval = 0

    private var recorder: AVAudioRecorder?
    private var startedAt: Date?

    /// whisper.cpp expects exactly this rate; anything else has to be resampled.
    ///
    /// `nonisolated` because `samples(from:)` is nonisolated and reads it. The
    /// class is `@MainActor`, which would otherwise isolate this static too.
    /// Safe: `Double` is `Sendable` and this never changes.
    nonisolated static let sampleRate: Double = 16_000

    // Stays main-actor isolated: `[String: Any]` is not Sendable, and only
    // `start()` uses it.
    private static let settings: [String: Any] = [
        AVFormatIDKey: Int(kAudioFormatLinearPCM),
        AVSampleRateKey: AudioRecorder.sampleRate,
        AVNumberOfChannelsKey: 1,
        AVLinearPCMBitDepthKey: 16,
        AVLinearPCMIsFloatKey: false,
        AVLinearPCMIsBigEndianKey: false,
    ]

    func requestPermission() async -> Bool {
        await AVAudioApplication.requestRecordPermission()
    }

    func start() async {
        guard state != .recording else { return }

        guard await requestPermission() else {
            state = .failed("Mikrofonas neleidžiamas.")
            return
        }

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: [.duckOthers])
            try session.setActive(true, options: [])

            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("utterance-\(UUID().uuidString).wav")

            let recorder = try AVAudioRecorder(url: url, settings: Self.settings)
            recorder.isMeteringEnabled = true
            guard recorder.record() else {
                state = .failed("AVAudioRecorder atsisakė pradėti.")
                return
            }

            self.recorder = recorder
            self.startedAt = .now
            lastRecordingURL = url
            state = .recording
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    @discardableResult
    func stop() -> URL? {
        guard let recorder else { return nil }
        recorder.stop()
        lastDuration = startedAt.map { Date().timeIntervalSince($0) } ?? 0
        self.recorder = nil
        self.startedAt = nil
        state = .idle

        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        return recorder.url
    }

    /// Reads a recorded WAV back as the float samples whisper wants.
    ///
    /// `AVAudioFile.processingFormat` is deinterleaved float32, so reading
    /// through it converts from the file's 16-bit integer storage for free.
    /// The file is already mono at 16 kHz, so no resampling happens here — if
    /// that ever stops being true this throws rather than silently feeding
    /// whisper the wrong rate.
    nonisolated static func samples(from url: URL) throws -> [Float] {
        let file = try AVAudioFile(forReading: url)
        let format = file.processingFormat

        guard format.sampleRate == sampleRate else {
            throw CocoaError(.fileReadCorruptFile)
        }

        let frameCount = AVAudioFrameCount(file.length)
        guard frameCount > 0,
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount)
        else { return [] }

        try file.read(into: buffer)
        guard let channel = buffer.floatChannelData?[0] else { return [] }

        return Array(UnsafeBufferPointer(start: channel, count: Int(buffer.frameLength)))
    }
}
