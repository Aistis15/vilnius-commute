import Foundation
import whisper

/// Thin Swift wrapper over the whisper.cpp C API.
///
/// Every symbol used here was read from `include/whisper.h` at the pinned tag
/// (see Tools/whisper/whisper-version.txt), not from memory.
///
/// An `actor` because `whisper_context` is not thread-safe and `whisper_full`
/// blocks for seconds: keeping the pointer actor-isolated makes it impossible
/// to call into it concurrently, and keeps the work off the main thread.
actor WhisperTranscriber {

    enum Failure: Error, LocalizedError {
        case contextInitFailed(String)
        case noModelLoaded
        case inferenceFailed(Int32)

        var errorDescription: String? {
            switch self {
            case .contextInitFailed(let path):
                "Nepavyko atidaryti modelio: \(path)"
            case .noModelLoaded:
                "Modelis neįkeltas."
            case .inferenceFailed(let code):
                "whisper_full klaida: \(code)"
            }
        }
    }

    struct Transcript: Sendable {
        let text: String
        /// Wall-clock seconds spent inside `whisper_full`.
        let duration: TimeInterval
    }

    /// `nonisolated(unsafe)` so `deinit` can free the context. A `deinit` is
    /// never actor-isolated, and `OpaquePointer` is not `Sendable`, so without
    /// this the compiler refuses the cleanup — and leaking a whisper context
    /// leaks hundreds of megabytes. Every other access goes through this
    /// actor's methods, so it stays serialised in practice.
    private nonisolated(unsafe) var context: OpaquePointer?
    private var loadedModelPath: String?

    var isLoaded: Bool { context != nil }
    var modelPath: String? { loadedModelPath }

    func load(modelAt url: URL) throws {
        unload()

        var params = whisper_context_default_params()
        // Metal on a phone is a large win for the bigger models and is
        // already linked by the framework's module map.
        params.use_gpu = true
        params.flash_attn = false

        let path = url.path(percentEncoded: false)
        guard let ctx = whisper_init_from_file_with_params(path, params) else {
            throw Failure.contextInitFailed(url.lastPathComponent)
        }
        context = ctx
        loadedModelPath = path
    }

    func unload() {
        if let context {
            whisper_free(context)
        }
        context = nil
        loadedModelPath = nil
    }

    /// Transcribes 16 kHz mono float samples.
    ///
    /// - Parameter language: ISO code. `lt` is a supported whisper language
    ///   (id 34 in `whisper.cpp`'s table) — Apple's own speech engine has no
    ///   Lithuanian, which is the entire reason whisper is here.
    func transcribe(samples: [Float], language: String = "lt") throws -> Transcript {
        guard let context else { throw Failure.noModelLoaded }

        var params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY)
        params.print_realtime   = false
        params.print_progress   = false
        params.print_timestamps = false
        params.print_special    = false
        params.translate        = false      // transcribe Lithuanian, never translate to English
        params.detect_language  = false
        params.no_timestamps    = true
        params.single_segment   = false
        params.suppress_blank   = true
        params.n_threads        = Int32(max(1, min(8, ProcessInfo.processInfo.activeProcessorCount - 1)))

        let started = Date()

        // `language` must stay alive for the whole call: the struct holds a
        // borrowed C string, it does not copy.
        let status: Int32 = language.withCString { languagePointer in
            params.language = languagePointer
            return samples.withUnsafeBufferPointer { buffer in
                whisper_full(context, params, buffer.baseAddress, Int32(buffer.count))
            }
        }

        guard status == 0 else { throw Failure.inferenceFailed(status) }

        var text = ""
        for index in 0..<whisper_full_n_segments(context) {
            if let segment = whisper_full_get_segment_text(context, index) {
                text += String(cString: segment)
            }
        }

        return Transcript(
            text: text.trimmingCharacters(in: .whitespacesAndNewlines),
            duration: Date().timeIntervalSince(started)
        )
    }

    deinit {
        if let context {
            whisper_free(context)
        }
    }
}
