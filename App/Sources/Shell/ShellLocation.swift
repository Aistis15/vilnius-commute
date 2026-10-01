import CoreLocation
import Foundation

/// GPS and the compass for the page.
///
/// A page loaded over plain http on the home network is not a secure
/// context, so WebKit refuses it `navigator.geolocation`; the shell answers
/// instead (the native half of prototype/expo/App.js, on CLLocationManager).
///
/// It runs while the page watches and the app is on screen, and also while
/// a trip banner is up, in the background too: those updates keep the app
/// awake to switch the banner to its next moment (UIBackgroundModes
/// `location`, already in the Info.plist).
@MainActor
final class ShellLocation: NSObject {

    struct Fix: Encodable, Equatable {
        let latitude: Double
        let longitude: Double
        let accuracy: Double
        let altitude: Double?
        let altitudeAccuracy: Double?
        let heading: Double?
        let speed: Double?
        /// Epoch ms.
        let timestamp: Double
    }

    /// Called with each fix the page should get.
    var onFix: ((Fix) -> Void)?
    /// `(code, message)`: 1 permission denied, 2 position unavailable.
    var onFail: ((Int, String) -> Void)?
    /// `(degrees, accuracy in degrees or -1)`.
    var onHeading: ((Double, Int) -> Void)?
    /// Every fix during a trip, page or not.
    var onTripFix: (() -> Void)?

    static let denied = "Vietos naudoti neleista. Ją galima įjungti telefono nustatymuose."
    static let unavailable = "Vietos nustatyti nepavyko."

    private let manager = CLLocationManager()

    private(set) var pageWatching = false
    private var onceWaiting = false
    private var appActive = true
    private var tripRunning = false
    private var updating = false
    private var headingOn = false
    private(set) var lastFix: Fix?

    // The compass, throttled as App.js does: at most ~5 updates a second,
    // only after a turn of 2° or a change of accuracy, and the latest one
    // again every second while the phone is still (iOS goes quiet then and
    // the page drops a compass it has not heard from in 3 s).
    private var lastSentHeading: (deg: Double, accuracy: Int, at: Date)?
    private var latestHeading: (deg: Double, accuracy: Int)?
    private var headingRepeat: Timer?

    private static let freshSeconds: TimeInterval = 10
    private static let headingMinSeconds: TimeInterval = 0.2
    private static let headingMinTurn: Double = 2
    private static let headingRepeatSeconds: TimeInterval = 1

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = kCLDistanceFilterNone
        manager.headingFilter = 1
        manager.activityType = .otherNavigation
        manager.pausesLocationUpdatesAutomatically = false
    }

    // MARK: - What the page asks

    func pageStarted() {
        pageWatching = true
        if let fix = freshFix { onFix?(fix) }
        apply()
    }

    func pageStopped() {
        pageWatching = false
        apply()
    }

    func once() {
        if let fix = freshFix {
            onFix?(fix)
            return
        }
        onceWaiting = true
        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .denied, .restricted:
            onceWaiting = false
            onFail?(1, Self.denied)
        default:
            // A running stream answers with its next fix.
            if !updating { manager.requestLocation() }
        }
    }

    /// A new document: its watchers start from nothing.
    func pageReset() {
        pageWatching = false
        onceWaiting = false
        lastSentHeading = nil
        apply()
    }

    // MARK: - What the app tells it

    func setAppActive(_ active: Bool) {
        appActive = active
        apply()
    }

    func setTripRunning(_ running: Bool) {
        guard running != tripRunning else { return }
        tripRunning = running
        apply()
    }

    var freshFix: Fix? {
        guard let fix = lastFix,
              Date().timeIntervalSince1970 * 1000 - fix.timestamp < Self.freshSeconds * 1000
        else { return nil }
        return fix
    }

    // MARK: - Running or not

    private func apply() {
        let wantsPosition = (pageWatching && appActive) || tripRunning
        let wantsHeading = pageWatching && appActive

        if wantsPosition {
            switch manager.authorizationStatus {
            case .notDetermined:
                manager.requestWhenInUseAuthorization()
                return          // carried on from the authorization callback
            case .denied, .restricted:
                if pageWatching { onFail?(1, Self.denied) }
                stopAll()
                return
            default:
                break
            }
            // Only during a trip may updates go on with the screen locked.
            manager.allowsBackgroundLocationUpdates = tripRunning
            manager.showsBackgroundLocationIndicator = tripRunning
            if !updating {
                manager.startUpdatingLocation()
                updating = true
            }
        } else if updating {
            manager.stopUpdatingLocation()
            manager.allowsBackgroundLocationUpdates = false
            updating = false
        }

        if wantsHeading, CLLocationManager.headingAvailable() {
            if !headingOn {
                manager.startUpdatingHeading()
                headingOn = true
                startHeadingRepeat()
            }
        } else if headingOn {
            manager.stopUpdatingHeading()
            headingOn = false
            headingRepeat?.invalidate()
            headingRepeat = nil
            latestHeading = nil
        }
    }

    private func stopAll() {
        if updating { manager.stopUpdatingLocation() }
        if headingOn { manager.stopUpdatingHeading() }
        updating = false
        headingOn = false
        headingRepeat?.invalidate()
        headingRepeat = nil
    }

    private func startHeadingRepeat() {
        headingRepeat?.invalidate()
        let timer = Timer(timeInterval: Self.headingRepeatSeconds / 2, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.repeatHeading() }
        }
        RunLoop.main.add(timer, forMode: .common)
        headingRepeat = timer
    }

    private func repeatHeading() {
        guard let latest = latestHeading else { return }
        if let last = lastSentHeading, Date().timeIntervalSince(last.at) < Self.headingRepeatSeconds { return }
        sendHeading(latest.deg, latest.accuracy)
    }

    private func sendHeading(_ deg: Double, _ accuracy: Int) {
        lastSentHeading = (deg, accuracy, Date())
        onHeading?(deg, accuracy)
    }

    // MARK: - Turning readings into the page's shape

    fileprivate func received(_ location: CLLocation) {
        let fix = Self.fix(from: location)
        lastFix = fix
        if pageWatching || onceWaiting {
            onceWaiting = false
            onFix?(fix)
        }
        if tripRunning { onTripFix?() }
    }

    fileprivate func received(trueHeading: Double, magneticHeading: Double, headingAccuracy: Double) {
        // True heading, magnetic when true is unknown.
        let deg = trueHeading >= 0 ? trueHeading : magneticHeading
        guard deg >= 0 else { return }
        let accuracy = Self.compassDegrees(headingAccuracy)
        latestHeading = (deg, accuracy)
        if let last = lastSentHeading {
            if Date().timeIntervalSince(last.at) < Self.headingMinSeconds { return }
            if Self.turned(last.deg, deg) < Self.headingMinTurn, last.accuracy == accuracy { return }
        }
        sendHeading(deg, accuracy)
    }

    fileprivate func failed(_ error: any Error) {
        let code = (error as? CLError)?.code
        if code == .locationUnknown { return }     // transient: the next fix may come
        onceWaiting = false
        if code == .denied {
            onFail?(1, Self.denied)
        } else {
            onFail?(2, Self.unavailable)
        }
    }

    fileprivate func authorizationChanged() {
        switch manager.authorizationStatus {
        case .denied, .restricted:
            if pageWatching || onceWaiting { onFail?(1, Self.denied) }
            onceWaiting = false
            stopAll()
        case .notDetermined:
            break
        default:
            if onceWaiting, !updating { manager.requestLocation() }
            apply()
        }
    }

    static func fix(from location: CLLocation) -> Fix {
        let vertical = location.verticalAccuracy
        return Fix(
            latitude: location.coordinate.latitude,
            longitude: location.coordinate.longitude,
            accuracy: location.horizontalAccuracy,
            altitude: vertical >= 0 ? location.altitude : nil,
            altitudeAccuracy: vertical >= 0 ? vertical : nil,
            // iOS gives -1 for "unknown"; the Web API says null.
            heading: location.course >= 0 ? location.course : nil,
            speed: location.speed >= 0 ? location.speed : nil,
            timestamp: (location.timestamp.timeIntervalSince1970 * 1000).rounded()
        )
    }

    /// iOS's heading accuracy in degrees, put through the calibration levels
    /// expo-location reports (its LocationUtils.swift: over 50 or negative is
    /// none, over 35 low, over 20 medium, else high) and back into degrees as
    /// App.js does (high 20, medium 35, low 50, none -1), so the page gets the
    /// same numbers from both shells.
    static func compassDegrees(_ accuracy: CLLocationDirection) -> Int {
        if accuracy > 50 || accuracy < 0 { return -1 }
        if accuracy > 35 { return 50 }
        if accuracy > 20 { return 35 }
        return 20
    }

    static func turned(_ a: Double, _ b: Double) -> Double {
        abs((b - a + 540).truncatingRemainder(dividingBy: 360) - 180)
    }
}

extension ShellLocation: CLLocationManagerDelegate {
    // The manager was made on the main thread, so it calls back there.

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        MainActor.assumeIsolated {
            if let last = locations.last { received(last) }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
        // CLHeading is not Sendable: take its numbers before crossing over.
        let trueHeading = newHeading.trueHeading
        let magneticHeading = newHeading.magneticHeading
        let headingAccuracy = newHeading.headingAccuracy
        MainActor.assumeIsolated {
            received(trueHeading: trueHeading, magneticHeading: magneticHeading, headingAccuracy: headingAccuracy)
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: any Error) {
        MainActor.assumeIsolated { failed(error) }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        MainActor.assumeIsolated { authorizationChanged() }
    }
}
