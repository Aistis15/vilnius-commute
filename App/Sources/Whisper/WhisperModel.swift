import Foundation
import Observation

/// A downloadable ggml model.
///
/// Sizes and URLs were checked against huggingface.co with a range request
/// before being written down; nothing here is estimated.
enum WhisperModel: String, CaseIterable, Identifiable, Sendable {
    case tinyQ5  = "ggml-tiny-q5_1.bin"
    case baseQ5  = "ggml-base-q5_1.bin"
    case smallQ5 = "ggml-small-q5_1.bin"

    var id: String { rawValue }

    /// Exact byte counts as served on 2026-09-23.
    var bytes: Int64 {
        switch self {
        case .tinyQ5:   32_152_673
        case .baseQ5:   59_707_625
        case .smallQ5: 190_085_487
        }
    }

    var displayName: String {
        switch self {
        case .tinyQ5:  "tiny"
        case .baseQ5:  "base"
        case .smallQ5: "small"
        }
    }

    /// Rough guidance only — Lithuanian quality per size is exactly what this
    /// screen exists to measure, so these are expectations, not results.
    var note: String {
        switch self {
        case .tinyQ5:  "31 MB · greičiausias, tikėtinai netikslus"
        case .baseQ5:  "57 MB · pradinis pasirinkimas"
        case .smallQ5: "181 MB · lėčiausias, tiksliausias"
        }
    }

    var downloadURL: URL {
        URL(string: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/\(rawValue)")!
    }
}

/// Downloads and stores ggml models in Application Support.
///
/// Models are not bundled in the IPA: the smallest useful one is 57 MB, and a
/// sideloaded build has to be reinstalled every 7 days. Downloading once and
/// keeping it on disk survives re-signing.
@MainActor
@Observable
final class WhisperModelStore {

    enum Status: Equatable {
        case absent
        case downloading(fraction: Double)
        case ready(URL)
        case failed(String)
    }

    private(set) var status: [WhisperModel: Status] = [:]

    init() {
        for model in WhisperModel.allCases {
            status[model] = localURL(for: model).map(Status.ready) ?? .absent
        }
    }

    private var directory: URL? {
        try? FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask,
            appropriateFor: nil, create: true
        )
    }

    /// The on-disk URL if the file exists *and* is the expected size.
    ///
    /// The size check matters: an interrupted download leaves a short file
    /// that whisper will happily open and then fail on, with a confusing error.
    func localURL(for model: WhisperModel) -> URL? {
        guard let directory else { return nil }
        let url = directory.appendingPathComponent(model.rawValue)
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
              let size = (attrs[.size] as? NSNumber)?.int64Value,
              size == model.bytes
        else { return nil }
        return url
    }

    func download(_ model: WhisperModel) async {
        guard let directory else {
            status[model] = .failed("Nėra kur saugoti.")
            return
        }
        if let existing = localURL(for: model) {
            status[model] = .ready(existing)
            return
        }

        status[model] = .downloading(fraction: 0)
        let destination = directory.appendingPathComponent(model.rawValue)

        // A delegate is used purely for the progress callback; the transfer
        // itself stays on the async `download` API, which streams straight to
        // disk instead of through memory.
        let progress = DownloadProgressDelegate { [weak self] fraction in
            Task { @MainActor in
                guard let self, case .downloading = self.status[model] else { return }
                self.status[model] = .downloading(fraction: fraction)
            }
        }

        do {
            let (tempURL, response) = try await URLSession.shared.download(
                from: model.downloadURL,
                delegate: progress
            )
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                let code = (response as? HTTPURLResponse)?.statusCode ?? -1
                status[model] = .failed("Serveris atsakė \(code).")
                return
            }

            // Verify before committing: a truncated model opens fine and then
            // fails deep inside whisper with an unhelpful error.
            let attributes = try FileManager.default.attributesOfItem(atPath: tempURL.path)
            let size = (attributes[.size] as? NSNumber)?.int64Value ?? 0
            guard size == model.bytes else {
                status[model] = .failed("Gauta \(size) B, laukta \(model.bytes) B.")
                return
            }

            try? FileManager.default.removeItem(at: destination)
            try FileManager.default.moveItem(at: tempURL, to: destination)
            status[model] = .ready(destination)
        } catch {
            status[model] = .failed(error.localizedDescription)
        }
    }

    func delete(_ model: WhisperModel) {
        guard let directory else { return }
        try? FileManager.default.removeItem(at: directory.appendingPathComponent(model.rawValue))
        status[model] = .absent
    }
}

/// Relays `URLSession` download progress without taking ownership of the
/// transfer — the async `download(from:delegate:)` call still returns the file.
private final class DownloadProgressDelegate: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    private let onProgress: @Sendable (Double) -> Void

    init(onProgress: @escaping @Sendable (Double) -> Void) {
        self.onProgress = onProgress
    }

    // Required by the protocol. The async API hands us the file, so there is
    // nothing to do here.
    func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didFinishDownloadingTo location: URL
    ) {}

    func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didWriteData bytesWritten: Int64,
        totalBytesWritten: Int64,
        totalBytesExpectedToWrite: Int64
    ) {
        guard totalBytesExpectedToWrite > 0 else { return }
        onProgress(Double(totalBytesWritten) / Double(totalBytesExpectedToWrite))
    }
}
