import Core
import SwiftUI

/// Starts a real countdown Live Activity so the lock screen and Dynamic
/// Island can be inspected on a physical, free-signed device.
///
/// The preview below the buttons is the exact same view the widget extension
/// draws, so what is on screen here is what should appear on the lock screen.
/// If they differ, the widget extension is the thing that is broken.
struct LiveActivityDemoView: View {
    @State private var controller = TripActivityController()

    private let sampleAttributes = TripActivityAttributes.sample
    private let sampleState = TripContentState.sample()

    var body: some View {
        List {
            Section {
                switch controller.status {
                case .idle:
                    Button("Paleisti") { controller.start() }
                case .running:
                    Button("Pridėti 5 min") {
                        Task { await controller.bumpCountdown() }
                    }
                    Button("Stabdyti", role: .destructive) {
                        Task { await controller.end() }
                    }
                case .failed(let message):
                    Label(message, systemImage: "xmark.circle.fill")
                        .foregroundStyle(.red)
                        .font(.footnote)
                    Button("Bandyti dar kartą") { controller.start() }
                }
            } header: {
                Text("Gyvoji veikla")
            } footer: {
                if controller.activitiesEnabled {
                    Text("Užrakink telefoną, kad pamatytum banerį.")
                } else {
                    Text("Sistemoje gyvosios veiklos išjungtos.")
                }
            }

            Section("Kaip atrodo") {
                TripLockScreenView(attributes: sampleAttributes, state: sampleState)
                    .listRowInsets(EdgeInsets())
            }
        }
        .navigationTitle("Gyvoji veikla")
        .navigationBarTitleDisplayMode(.inline)
        // A Live Activity outlives the app process, so on returning to this
        // screen there may already be one running that this controller has
        // never seen.
        .task { controller.adoptRunningActivity() }
    }
}

#Preview {
    NavigationStack { LiveActivityDemoView() }
}
