import Core
import SwiftUI

/// Phase 1 answer to "does Lithuanian speech-to-text work on this phone".
///
/// Apple's speech engine has no Lithuanian, so whisper.cpp is the only option.
/// What is unknown is whether a model small enough to run on a phone is
/// accurate enough to be useful — so this screen measures it instead of
/// assuming, with phrases the real parser will have to handle in Phase 5.
struct WhisperTestView: View {

    @State private var store = WhisperModelStore()
    @State private var recorder = AudioRecorder()
    @State private var transcriber = WhisperTranscriber()

    @State private var selected: WhisperModel = .baseQ5
    @State private var transcript: String = ""
    @State private var timing: String = ""
    @State private var audioLevel: String = ""
    @State private var problem: String?
    @State private var isWorking = false

    /// The phrases Phase 5's parser has to cope with. Reading these aloud is
    /// the actual test.
    private let testPhrases = [
        "ISM keturiolika dvidešimt",
        "Noriu būti OZAS aštuntą vakaro",
        "Namo pusę trijų",
        "ISM be penkiolikos trys, po to OZAS",
    ]

    var body: some View {
        List {
            modelSection
            recordSection
            resultSection
            phrasesSection
        }
        .commuteListChrome()
        .navigationTitle("Balsas")
        .navigationBarTitleDisplayMode(.inline)
    }

    // MARK: - Model

    private var modelSection: some View {
        Section {
            ForEach(WhisperModel.allCases) { model in
                ModelRow(
                    model: model,
                    status: store.status[model] ?? .absent,
                    isSelected: selected == model,
                    onSelect: { selected = model },
                    onDownload: { Task { await store.download(model) } },
                    onDelete: { store.delete(model) }
                )
            }
        } header: {
            Text("Modelis")
        } footer: {
            Text("Modeliai atsisiunčiami vieną kartą ir lieka telefone.")
        }
        .commuteCard()
    }

    // MARK: - Record

    private var recordSection: some View {
        Section("Įrašas") {
            switch recorder.state {
            case .recording:
                Button(role: .destructive) {
                    Task { await stopAndTranscribe() }
                } label: {
                    Label("Stabdyti ir atpažinti", systemImage: "stop.fill")
                }
            case .idle, .failed:
                Button {
                    Task { await recorder.start() }
                } label: {
                    Label("Įrašyti", systemImage: "mic")
                }
                .disabled(!isModelReady || isWorking)
            }

            if case .failed(let message) = recorder.state {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }

            if isWorking {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("Atpažįstama…")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .commuteCard()
    }

    // MARK: - Result

    @ViewBuilder
    private var resultSection: some View {
        if !transcript.isEmpty || problem != nil {
            Section("Rezultatas") {
                if let problem {
                    Text(problem)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
                if !transcript.isEmpty {
                    Text(transcript)
                        .font(.body)
                        .textSelection(.enabled)
                }
                if !timing.isEmpty {
                    Text(timing)
                        .font(.footnote)
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
                if !audioLevel.isEmpty {
                    Text(audioLevel)
                        .font(.footnote)
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
            }
            .commuteCard()
        }
    }

    private var phrasesSection: some View {
        Section {
            ForEach(testPhrases, id: \.self) { phrase in
                Text(phrase)
                    .font(.body)
            }
        } header: {
            Text("Ką pasakyti")
        } footer: {
            Text("Perskaityk garsiai ir palygink su rezultatu.")
        }
        .commuteCard()
    }

    // MARK: - Work

    private var isModelReady: Bool {
        if case .ready? = store.status[selected] { return true }
        return false
    }

    private func stopAndTranscribe() async {
        guard let url = recorder.stop() else { return }
        guard case .ready(let modelURL)? = store.status[selected] else {
            problem = "Modelis neparuoštas."
            return
        }

        isWorking = true
        problem = nil
        transcript = ""
        timing = ""
        audioLevel = ""
        defer { isWorking = false }

        let recordedSeconds = recorder.lastDuration

        do {
            let samples = try AudioRecorder.samples(from: url)
            guard !samples.isEmpty else {
                problem = "Įrašas tuščias."
                return
            }

            let loadStarted = Date()
            try await transcriber.load(modelAt: modelURL)
            let loadSeconds = Date().timeIntervalSince(loadStarted)

            let result = try await transcriber.transcribe(samples: samples, language: "lt")
            transcript = result.text.isEmpty ? "(tyla)" : result.text

            timing = String(
                format: "įrašas %.1f s · modelis %.1f s · atpažinimas %.1f s",
                recordedSeconds, loadSeconds, result.duration
            )

            // Reported next to the transcript so a wrong result can be
            // attributed rather than guessed at: near-silence means the
            // capture is at fault, a healthy level means the model is.
            let levels = AudioRecorder.levels(of: samples)
            audioLevel = String(
                format: "garsas: peak %.2f · rms %.3f%@",
                Double(levels.peak), Double(levels.rms),
                levels.peak < 0.05 ? "  ⚠︎ per tylu" : ""
            )
        } catch {
            problem = error.localizedDescription
        }
    }
}

// MARK: - Row

private struct ModelRow: View {
    let model: WhisperModel
    let status: WhisperModelStore.Status
    let isSelected: Bool
    let onSelect: () -> Void
    let onDownload: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: isSelected ? "largecircle.fill.circle" : "circle")
                .foregroundStyle(isSelected ? .primary : .secondary)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(model.displayName)
                Text(model.note)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            switch status {
            case .absent:
                Button("Siųsti", action: onDownload)
                    .buttonStyle(.bordered)
            case .downloading(let fraction):
                ProgressView(value: fraction)
                    .progressViewStyle(.circular)
                    .frame(width: 24)
            case .ready:
                Button {
                    onDelete()
                } label: {
                    Image(systemName: "trash")
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Ištrinti \(model.displayName)")
            case .failed(let message):
                Button("Bandyti vėl", action: onDownload)
                    .buttonStyle(.bordered)
                    .accessibilityHint(message)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: onSelect)
    }
}

#Preview {
    NavigationStack { WhisperTestView() }
}
