import Core
import SwiftUI

/// Phase 1 shell.
///
/// This is scaffolding, not the real app: it exists to reach the three things
/// Phase 1 has to prove — the Live Activity, the capability probe, and
/// Lithuanian speech-to-text. The trip planner arrives in Phase 3.
struct RootView: View {
    var body: some View {
        NavigationStack {
            List {
                Section {
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
            }
            .navigationTitle("Vilnius")
        }
    }
}

#Preview {
    RootView()
}
