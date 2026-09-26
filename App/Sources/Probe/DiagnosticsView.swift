import Core
import SwiftUI
import UIKit

/// Runs every capability check and hands the result over as one block of text.
///
/// The copy button is the point of this screen. Reading results off screenshots
/// one at a time is slow and loses things — the whole report in the clipboard
/// travels in a single paste.
struct DiagnosticsView: View {

    @State private var report: Diagnostics?
    @State private var isRunning = false
    @State private var copied = false
    @State private var isRequesting = false
    @State private var permissionTrace: [String] = []

    var body: some View {
        List {
            actions

            if !permissionTrace.isEmpty {
                Section("Leidimų prašymas") {
                    ForEach(permissionTrace, id: \.self) { entry in
                        Text(entry)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                .commuteCard()
            }

            if let report {
                ForEach(Array(report.sections.enumerated()), id: \.offset) { _, section in
                    Section(section.title) {
                        ForEach(Array(section.lines.enumerated()), id: \.offset) { _, line in
                            DiagnosticRow(line: line)
                        }
                    }
                    .commuteCard()
                }
            } else if isRunning {
                Section {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("Tikrinama…").foregroundStyle(.secondary)
                    }
                }
                .commuteCard()
            }
        }
        .commuteListChrome()
        .navigationTitle("Diagnostika")
        .navigationBarTitleDisplayMode(.inline)
        .task { await run() }
        .refreshable { await run() }
    }

    @ViewBuilder
    private var actions: some View {
        Section {
            Button {
                guard let report else { return }
                UIPasteboard.general.string = report.plainText
                copied = true
                // Long enough to read, short enough not to look stuck.
                Task {
                    try? await Task.sleep(for: .seconds(2))
                    copied = false
                }
            } label: {
                Label(
                    copied ? "Nukopijuota" : "Kopijuoti ataskaitą",
                    systemImage: copied ? "checkmark" : "doc.on.doc"
                )
            }
            .disabled(report == nil)

            if let report {
                ShareLink(item: report.plainText) {
                    Label("Siųsti", systemImage: "square.and.arrow.up")
                }
            }

            Button {
                Task {
                    isRequesting = true
                    permissionTrace = await PermissionRequester().requestAll()
                    isRequesting = false
                    await run()
                }
            } label: {
                Label(
                    isRequesting ? "Klausiama…" : "Prašyti visų leidimų",
                    systemImage: "hand.raised"
                )
            }
            .disabled(isRequesting)

            Button {
                Task { await run() }
            } label: {
                Label("Tikrinti iš naujo", systemImage: "arrow.clockwise")
            }
            .disabled(isRunning)
        } footer: {
            Text("Paspausk „Kopijuoti“ ir įklijuok pokalbyje — to užtenka, nuotraukų nereikia.")
        }
        .commuteCard()
    }

    private func run() async {
        isRunning = true
        defer { isRunning = false }
        report = await Diagnostics.collect()
    }
}

private struct DiagnosticRow: View {
    let line: Diagnostics.Line

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .foregroundStyle(tint)
                .frame(width: 20)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(line.label)
                    .font(.subheadline)
                Text(line.value)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
            }
        }
        .padding(.vertical, 1)
        .accessibilityElement(children: .combine)
    }

    private var symbol: String {
        switch line.ok {
        case .some(true):  "checkmark.circle.fill"
        case .some(false): "exclamationmark.triangle.fill"
        case .none:        "circle.dotted"
        }
    }

    private var tint: Color {
        switch line.ok {
        case .some(true):  .primary
        case .some(false): .red      // system red for alerts, per the design rules
        case .none:        .secondary
        }
    }
}

#Preview {
    NavigationStack { DiagnosticsView() }
}
