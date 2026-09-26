import Core
import SwiftUI

/// Phase 1 shell.
///
/// The banner is not one feature among several — it is the interface. The
/// whole premise is that you never open the app: you glance at the lock screen
/// and know when to leave. So starting one is the first thing here, one tap,
/// rather than something to navigate to.
struct RootView: View {
    @State private var controller = TripActivityController()

    var body: some View {
        NavigationStack {
            List {
                banner
                tools
            }
            .commuteListChrome()
            .navigationTitle("Vilnius")
            .task { controller.adoptRunningActivity() }
        }
    }

    // MARK: - One tap

    private var banner: some View {
        Section {
            switch controller.status {
            case .idle, .failed:
                Button {
                    controller.start()
                } label: {
                    Label("Rodyti banerį", systemImage: "play.circle.fill")
                        .font(.headline)
                }

            case .running:
                Button(role: .destructive) {
                    Task { await controller.end() }
                } label: {
                    Label("Slėpti banerį", systemImage: "stop.circle.fill")
                        .font(.headline)
                }
            }

            if case .failed(let message) = controller.status {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.red)
            } else if let action = controller.lastAction {
                Text(action)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        } header: {
            Text("Baneris")
        } footer: {
            if controller.status == .running {
                Text("Užrakink telefoną — baneris turi būti tarp pranešimų.")
            } else {
                Text("Vienas paspaudimas paleidžia banerį užrakto ekrane.")
            }
        }
        .commuteCard()
    }

    // MARK: - Everything else

    private var tools: some View {
        Section {
            NavigationLink {
                DiagnosticsView()
            } label: {
                Label("Diagnostika", systemImage: "stethoscope")
            }
            NavigationLink {
                LiveActivityDemoView()
            } label: {
                Label("Gyvoji veikla", systemImage: "bell.badge")
            }
            NavigationLink {
                ProbeView()
            } label: {
                Label("Patikra", systemImage: "checklist")
            }
            NavigationLink {
                WhisperTestView()
            } label: {
                Label("Balsas", systemImage: "mic")
            }
        } footer: {
            Text("1 etapas: tikrinama, ką leidžia nemokama Apple paskyra.")
        }
        .commuteCard()
    }
}

#Preview {
    RootView()
}
