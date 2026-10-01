import Core
import SwiftUI

/// Puts up the design's sample trip banner so the lock screen and Dynamic
/// Island can be inspected on a physical, free-signed device without the PC.
///
/// The preview shows the **live** Activity's content, not a fixed sample:
/// with a frozen sample, a button that changed the real banner changed
/// nothing here, which is indistinguishable from a button that does nothing.
struct LiveActivityDemoView: View {
    @State private var controller = TripActivityController()

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
        .task { controller.refresh() }
        .refreshable { controller.refresh() }
    }

    // MARK: - Controls

    private var controls: some View {
        Section {
            switch controller.status {
            case .idle:
                Button {
                    Task { await controller.start() }
                } label: {
                    Label("Paleisti", systemImage: "play.fill")
                }

            case .running:
                Button {
                    Task { await controller.nextPage() }
                } label: {
                    Label("Kitas puslapis", systemImage: "arrow.right.circle")
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
                Button("Bandyti dar kartą") { Task { await controller.start() } }
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
            TripBannerView(state: controller.liveState ?? BannerSamples.state(BannerSamples.countdown))
                .listRowInsets(EdgeInsets())
        } header: {
            Text(controller.liveState == nil ? "Pavyzdys" : "Kas dabar rodoma")
        } footer: {
            if controller.liveState != nil {
                Text("Tai tikras veikiančios veiklos turinys. Kampas „Kitas puslapis“ keičia jį ir čia.")
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
