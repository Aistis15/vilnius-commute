import Core
import SwiftUI

/// The shell (docs/ios-shell.md): the prototype's own screens, full screen,
/// from the PC; or, until there is an address, the screen that asks for one.
///
/// Diagnostics and the Phase 1 probes are reached from the page
/// (`{type: "native", screen: "diagnostics"}`), not from here.
struct RootView: View {
    @State private var model = ShellModel.shared

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                switch model.phase {
                case .setup:
                    ShellSetupView(initialAddress: model.typedAddress) { model.connect(to: $0) }
                case .loading, .ready, .failed:
                    ShellWebView(model: model, insets: Self.insets(proxy))
                        .id(model.attempt)
                        .ignoresSafeArea()
                    if model.phase == .loading {
                        ShellLoadingView()
                    } else if model.phase == .failed {
                        ShellFailureView(onRetry: { model.retry() }, onChangeAddress: { model.changeAddress() })
                    }
                }
            }
        }
        // The keyboard is the page's business: it must not shrink the insets.
        .ignoresSafeArea(.keyboard)
        .sheet(isPresented: $model.showsDiagnostics) {
            NavigationStack {
                DiagnosticsView(onChangeAddress: model.server == nil ? nil : { model.changeAddress() })
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Uždaryti") { model.showsDiagnostics = false }
                        }
                    }
            }
        }
    }

    private static func insets(_ proxy: GeometryProxy) -> ShellScript.Insets {
        let edges = proxy.safeAreaInsets
        return ShellScript.Insets(top: edges.top, right: edges.trailing,
                                  bottom: edges.bottom, left: edges.leading)
    }
}

#Preview {
    RootView()
}
