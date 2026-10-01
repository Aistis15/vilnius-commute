import Core
import Foundation
import Observation
import UIKit
import WebKit

/// The shell's state: which screen shows, the page's web view, and the
/// native half of the message contract (docs/ios-shell.md).
///
/// One per app: deep links, banner taps and the scene's comings and goings
/// all reach the same page.
@MainActor
@Observable
final class ShellModel {

    static let shared = ShellModel()

    enum Phase: Equatable {
        /// No address yet, or the rider asked to change it.
        case setup
        case loading
        case ready
        case failed
    }

    private(set) var phase: Phase
    private(set) var server: URL?
    /// Changes to throw the web view away and build a fresh one: `reload()`
    /// does nothing after a failed first load, and a fresh view's script
    /// carries the storage as the page last saved it.
    private(set) var attempt = 0
    /// The page asked for the diagnostics screen.
    var showsDiagnostics = false
    /// The last thing that went wrong with the banner, for diagnostics.
    private(set) var activityError: String?

    @ObservationIgnored private(set) weak var webView: WKWebView?
    @ObservationIgnored private var coordinator: ShellWebCoordinator!
    @ObservationIgnored private let location = ShellLocation()
    @ObservationIgnored private var mirror: [String: String]
    @ObservationIgnored private var insets = ShellScript.Insets.zero
    @ObservationIgnored private var tripTimer: Task<Void, Never>?
    @ObservationIgnored private var lastTripRefresh = Date.distantPast
    @ObservationIgnored private var loadTimeout: Task<Void, Never>?
    @ObservationIgnored private var actionObserver: (any NSObjectProtocol)?

    private static let storeKey = "vc.webStorage"
    private static let loadSeconds: TimeInterval = 20

    private init() {
        mirror = UserDefaults.standard.dictionary(forKey: Self.storeKey) as? [String: String] ?? [:]
        server = ShellAddress.saved
        phase = server == nil ? .setup : .loading

        location.onFix = { [weak self] fix in
            self?.call("window.__vcShell.fix(\(ShellScript.literal(fix)))")
        }
        location.onFail = { [weak self] code, message in
            self?.call("window.__vcShell.fail(\(code), \(ShellScript.literal(message)))")
        }
        location.onHeading = { [weak self] deg, accuracy in
            self?.call("window.__vcShell.heading(\(String(format: "%.1f", deg)), \(accuracy))")
        }
        location.onTripFix = { [weak self] in self?.refreshTripSoon() }

        actionObserver = NotificationCenter.default.addObserver(
            forName: BannerActionQueue.notification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.deliverActions() }
        }
        location.setTripRunning(TripBanner.shared.isRunning)
        coordinator = ShellWebCoordinator(model: self)
    }

    // MARK: - Address

    /// Saves a typed address and loads it. False when it is not an address.
    @discardableResult
    func connect(to typed: String) -> Bool {
        guard let url = ShellAddress.parse(typed) else { return false }
        connect(url)
        return true
    }

    func connect(_ url: URL) {
        ShellAddress.saved = url
        server = url
        reload()
    }

    func changeAddress() {
        showsDiagnostics = false
        phase = .setup
    }

    func retry() {
        guard server != nil else {
            phase = .setup
            return
        }
        reload()
    }

    private func reload() {
        phase = .loading
        attempt += 1
    }

    var typedAddress: String {
        server.map(ShellAddress.display) ?? ""
    }

    // MARK: - Links into the app

    /// `vilniuscommute://connect?url=…`, `…://trip`, `…://replan`.
    func open(_ url: URL) {
        guard url.scheme?.lowercased() == "vilniuscommute" else { return }
        if let server = ShellAddress.fromConnectLink(url) {
            connect(server)
            return
        }
        switch url.host?.lowercased() {
        case "trip": BannerActionQueue.post("trip")
        case "replan": BannerActionQueue.post("replan")
        default: break
        }
    }

    // MARK: - The scene

    func appBecameActive() {
        location.setAppActive(true)
        Task { await refreshTrip() }
        startTripTimer()
    }

    func appEnteredBackground() {
        location.setAppActive(false)
        tripTimer?.cancel()
        tripTimer = nil
    }

    // MARK: - The web view

    /// Built by `ShellWebView` for each attempt.
    func makeWebView(insets: ShellScript.Insets) -> WKWebView {
        self.insets = insets
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.userContentController.add(WeakScriptHandler(coordinator), name: "vc")
        configuration.userContentController.addUserScript(userScript())

        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = coordinator
        view.uiDelegate = coordinator
        view.isInspectable = true                   // Safari › Develop on a Mac
        view.allowsBackForwardNavigationGestures = false
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.scrollView.bounces = false
        view.isOpaque = false
        view.backgroundColor = .systemBackground
        webView = view

        if let server, let page = ShellAddress.page(for: server) {
            view.load(URLRequest(url: page, timeoutInterval: Self.loadSeconds))
            startLoadTimeout()
        }
        return view
    }

    /// The safe area moved (rotation is off, but the island and the home
    /// indicator are measured only once the view is in a window).
    func updateInsets(_ new: ShellScript.Insets) {
        guard new != insets else { return }
        insets = new
        guard let webView else { return }
        webView.configuration.userContentController.removeAllUserScripts()
        webView.configuration.userContentController.addUserScript(userScript())
        call("window.__vcShell.insets(\(ShellScript.literal(new)))")
    }

    private func userScript() -> WKUserScript {
        WKUserScript(
            source: ShellScript.source(
                saved: mirror,
                insets: insets,
                stream: server.map(ShellAddress.streams) ?? true
            ),
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
    }

    /// `window.__vcShell && <code>`: a page without the script ignores it.
    func call(_ code: String) {
        webView?.evaluateJavaScript("window.__vcShell && \(code); true", completionHandler: nil)
    }

    var origin: String? { server.flatMap(ShellAddress.origin(of:)) }

    // MARK: - Navigation, from the coordinator

    func pageStarted() {
        location.pageReset()
    }

    func pageLoaded() {
        guard phase != .failed, phase != .setup else { return }
        loadTimeout?.cancel()
        phase = .ready
        // Only a recent fix: the page takes each one as where the phone is now.
        if let fix = location.freshFix {
            call("window.__vcShell.fix(\(ShellScript.literal(fix)))")
        }
        deliverActions()
    }

    func pageFailed() {
        guard phase == .loading else { return }
        loadTimeout?.cancel()
        phase = .failed
        StatusBar.shared.style = .default
    }

    func pageCrashed() {
        // A fresh view, not reload(): its script carries the storage as the
        // page last saved it, not as it was when this view opened.
        reload()
    }

    private func startLoadTimeout() {
        loadTimeout?.cancel()
        loadTimeout = Task { [weak self] in
            try? await Task.sleep(for: .seconds(Self.loadSeconds + 2))
            guard !Task.isCancelled else { return }
            self?.pageFailed()
        }
    }

    // MARK: - Messages from the page

    func received(_ text: String) {
        guard let data = text.data(using: .utf8),
              let message = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let type = message["type"] as? String
        else { return }

        switch type {
        case "geo-start": location.pageStarted()
        case "geo-stop": location.pageStopped()
        case "geo-once": location.once()
        case "store": store(message)
        case "chrome":
            if let dark = message["dark"] as? Bool {
                StatusBar.shared.style = dark ? .lightContent : .darkContent
            }
        case "activity": activity(data)
        case "native":
            if message["screen"] as? String == "diagnostics" { showsDiagnostics = true }
        case "haptic": haptic(message["kind"] as? String)
        default:
            break       // unknown types are ignored, as the contract says
        }
    }

    private func store(_ message: [String: Any]) {
        let key = message["key"] as? String
        switch message["op"] as? String {
        case "set":
            guard let key, let value = message["value"] as? String else { return }
            mirror[key] = value
        case "remove":
            guard let key else { return }
            mirror.removeValue(forKey: key)
        case "clear":
            mirror.removeAll()
        default:
            return
        }
        UserDefaults.standard.set(mirror, forKey: Self.storeKey)
    }

    private func haptic(_ kind: String?) {
        switch kind {
        case "success": UINotificationFeedbackGenerator().notificationOccurred(.success)
        case "warning": UINotificationFeedbackGenerator().notificationOccurred(.warning)
        default: UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }
    }

    private func activity(_ data: Data) {
        let message: ActivityMessage
        do {
            message = try JSONDecoder().decode(ActivityMessage.self, from: data)
        } catch {
            activityError = "Netinkamas banerio pranešimas: \(error)"
            return
        }
        Task {
            do {
                try await TripBanner.shared.handle(message)
                activityError = nil
            } catch {
                activityError = String(describing: error)
            }
            location.setTripRunning(TripBanner.shared.isRunning)
            startTripTimer()
        }
    }

    // MARK: - The banner as time passes

    /// While the app is open, a timer moves the banner to the moment due;
    /// asleep, the location updates during a trip do it.
    private func startTripTimer() {
        guard tripTimer == nil, TripBanner.shared.isRunning,
              UIApplication.shared.applicationState != .background
        else { return }
        tripTimer = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(15))
                guard let self, !Task.isCancelled else { return }
                await self.refreshTrip()
                if !TripBanner.shared.isRunning {
                    self.tripTimer = nil
                    return
                }
            }
        }
    }

    private func refreshTripSoon() {
        guard Date().timeIntervalSince(lastTripRefresh) >= 5 else { return }
        lastTripRefresh = Date()
        Task { await refreshTrip() }
    }

    private func refreshTrip() async {
        await TripBanner.shared.refresh()
        location.setTripRunning(TripBanner.shared.isRunning)
    }

    /// Taps on the banner, told to the page once it is there to hear them.
    private func deliverActions() {
        guard phase == .ready, webView != nil else { return }
        for name in BannerActionQueue.drain() {
            call("window.__vcShell.action(\(ShellScript.literal(name)))")
        }
        location.setTripRunning(TripBanner.shared.isRunning)
    }
}

/// `WKUserContentController` keeps its handlers strongly; this keeps the
/// coordinator weakly so the web view and the model do not hold each other.
@MainActor
private final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    weak var target: (any WKScriptMessageHandler)?

    init(_ target: any WKScriptMessageHandler) {
        self.target = target
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}
