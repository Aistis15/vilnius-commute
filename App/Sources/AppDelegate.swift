import SwiftUI
import UIKit

// UIKit lifecycle rather than a SwiftUI `App`, for one reason: the status
// bar has to follow what the page shows ({type: "chrome"}), and only a root
// view controller can say so. SwiftUI's own way, `preferredColorScheme`,
// would also flip the page's prefers-color-scheme and repaint it.

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        configurationForConnecting connectingSceneSession: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: "Default", sessionRole: connectingSceneSession.role)
        configuration.delegateClass = SceneDelegate.self
        return configuration
    }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        let root = ShellHostingController(rootView: RootView())
        StatusBar.shared.controller = root
        window.rootViewController = root
        window.makeKeyAndVisible()
        self.window = window

        // Opened by a link: the connect QR code, or a tap on the banner.
        for context in connectionOptions.urlContexts {
            ShellModel.shared.open(context.url)
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts {
            ShellModel.shared.open(context.url)
        }
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        ShellModel.shared.appBecameActive()
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        ShellModel.shared.appEnteredBackground()
    }
}

/// The root controller, there to own the status bar style.
final class ShellHostingController: UIHostingController<RootView> {
    var statusBarStyle: UIStatusBarStyle = .default {
        didSet {
            guard statusBarStyle != oldValue else { return }
            setNeedsStatusBarAppearanceUpdate()
        }
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { statusBarStyle }
}

/// Light or dark status bar text, as the page asks.
@MainActor
final class StatusBar {
    static let shared = StatusBar()

    weak var controller: ShellHostingController?

    var style: UIStatusBarStyle {
        get { controller?.statusBarStyle ?? .default }
        set { controller?.statusBarStyle = newValue }
    }
}
