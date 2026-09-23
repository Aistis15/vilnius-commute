import Core
import SwiftUI

/// Phase 1 go/no-go screen: what this free-signed build can and cannot do.
///
/// Monochrome by design. The only colour here is system red, and only for a
/// hard failure — transit colour is reserved for route badges.
struct ProbeView: View {
    @State private var probe = CapabilityProbe()

    var body: some View {
        List {
            Section {
                ForEach(probe.results) { result in
                    ProbeRow(result: result)
                }
            } header: {
                Text("Galimybės")
            } footer: {
                if let lastRun = probe.lastRun {
                    Text("Tikrinta \(TimeFormat.clock(lastRun))")
                        .monospacedDigit()
                }
            }

            Section("Prašyti leidimų") {
                Button("Žadintuvai (AlarmKit)") {
                    Task { await probe.requestAlarmAuthorization() }
                }
                Button("Vieta") {
                    probe.requestLocationAuthorization()
                }
            }

            Section {
                Button("Tikrinti iš naujo") {
                    Task { await probe.runAll() }
                }
                Button("Išvalyti įrašymo žymę", role: .destructive) {
                    Task { await probe.clearLockScreenMarker() }
                }
            }
        }
        .commuteListChrome()
        .navigationTitle("Patikra")
        .navigationBarTitleDisplayMode(.inline)
        .task { await probe.runAll() }
        .refreshable { await probe.runAll() }
    }
}

private struct ProbeRow: View {
    let result: ProbeResult

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .foregroundStyle(tint)
                .font(.body)
                .frame(width: 22)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(result.title)
                Text(result.detail)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(result.title). \(spokenOutcome). \(result.detail)")
    }

    private var symbol: String {
        switch result.outcome {
        case .pass:      "checkmark.circle.fill"
        case .fail:      "xmark.circle.fill"
        case .needsUser: "exclamationmark.circle"
        case .unknown:   "questionmark.circle"
        }
    }

    private var tint: Color {
        switch result.outcome {
        case .pass:      .primary
        case .fail:      .red        // system red for alerts, per the design rules
        case .needsUser: .secondary
        case .unknown:   .secondary
        }
    }

    private var spokenOutcome: String {
        switch result.outcome {
        case .pass:      "veikia"
        case .fail:      "neveikia"
        case .needsUser: "reikia leidimo"
        case .unknown:   "nepatikrinta"
        }
    }
}

#Preview {
    NavigationStack { ProbeView() }
}
