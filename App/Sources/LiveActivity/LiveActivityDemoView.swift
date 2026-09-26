import Core
import SwiftUI

/// Starts a real countdown Live Activity so the lock screen and Dynamic
/// Island can be inspected on a physical, free-signed device.
///
/// The preview shows the **live** Activity's content, not a fixed sample.
/// That distinction turned out to matter: with a frozen sample, "add 5
/// minutes" updated the real banner on the lock screen and changed nothing on
/// this screen, which is indistinguishable from a button that does nothing.
struct LiveActivityDemoView: View {
    @State private var controller = TripActivityController()

    /// Only used before anything is running, to show what a banner looks like.
    private let sampleAttributes = TripActivityAttributes.sample

    var body: some View {
        List {
            controls
            preview
            explanation
        }
        .commuteListChrome()
        .navigationTitle("Gyvoji veikla")
        .navigationBarTitleDisplayMode(.inline)
        // A Live Activity outlives the app process, so on returning here there
        // may already be one running that this controller has never seen.
        .task { controller.adoptRunningActivity() }
        .refreshable { controller.refresh() }
    }

    // MARK: - Controls

    private var controls: some View {
        Section {
            switch controller.status {
            case .idle:
                Button {
                    controller.start()
                } label: {
                    Label("Paleisti", systemImage: "play.fill")
                }

            case .running:
                Button {
                    Task { await controller.bumpCountdown() }
                } label: {
                    Label("Pridėti 5 min", systemImage: "plus.circle")
                }
                Button(role: .destructive) {
                    Task { await controller.end() }
                } label: {
                    Label("Stabdyti", systemImage: "stop.fill")
                }

            case .failed(let message):
                Label(message, systemImage: "xmark.circle.fill")
                    .foregroundStyle(.red)
                    .font(.footnote)
                Button("Bandyti dar kartą") { controller.start() }
            }

            // Every action reports back, so nothing looks like a dead button.
            if let action = controller.lastAction {
                Label(action, systemImage: "checkmark.circle")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        } header: {
            Text("Gyvoji veikla")
        } footer: {
            if controller.activitiesEnabled {
                Text("Baneris atsiranda užrakto ekrane pats — pridėti jo nereikia ir negalima.")
            } else {
                Text("Sistemoje gyvosios veiklos išjungtos.")
            }
        }
        .commuteCard()
    }

    // MARK: - Preview

    private var preview: some View {
        Section {
            TripLockScreenView(
                attributes: sampleAttributes,
                state: controller.liveState ?? TripContentState.sample()
            )
            .listRowInsets(EdgeInsets())
        } header: {
            Text(controller.liveState == nil ? "Pavyzdys" : "Kas dabar rodoma")
        } footer: {
            if controller.liveState != nil {
                Text("Tai tikras veikiančios veiklos turinys. Paspaudus „Pridėti 5 min“ laikas pasikeis ir čia.")
            } else {
                Text("Kol nieko neveikia — tik pavyzdys, kaip atrodys.")
            }
        }
        .commuteCard()
    }

    // MARK: - Explanation

    /// Spelled out because it is a genuine iOS gotcha: a Live Activity is not
    /// a widget and cannot be added from the widget gallery. Looking for it
    /// there and not finding it reads like a broken app.
    private var explanation: some View {
        Section("Kur ieškoti") {
            Label(
                "Užrakink telefoną — baneris bus tarp pranešimų, apačioje.",
                systemImage: "lock"
            )
            .font(.footnote)

            Label(
                "Jei telefonas turi Dynamic Island — palik programėlę fone ir žiūrėk į salelę viršuje.",
                systemImage: "iphone"
            )
            .font(.footnote)

            Label(
                "Widget'ų galerijoje jo NĖRA ir nebus — gyvoji veikla ne widget'as, jos pridėti negalima.",
                systemImage: "exclamationmark.triangle"
            )
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
        .commuteCard()
    }
}

#Preview {
    NavigationStack { LiveActivityDemoView() }
}
