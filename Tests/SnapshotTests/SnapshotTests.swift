import SwiftUI
import Testing
import WidgetKit

@testable import Core
@testable import VilniusCommute

/// Renders every Phase 1 surface to PNG so the UI can be reviewed without a
/// Mac. These are not assertions about pixels — nothing is compared against a
/// stored reference. Their job is to produce evidence a human looks at, which
/// is the only visual QA available when the development machine is Windows.
///
/// The files land in `artifacts/snapshots/` and CI uploads them.
@MainActor
@Suite("Snapshots", .serialized)
struct SnapshotTests {

    /// Base time for the sample trips, relative to the real clock on purpose.
    ///
    /// A pinned epoch was tried first and was wrong: `Text(timerInterval:)`
    /// renders against the actual current time, so a base in the past made
    /// every countdown draw as `00:00`. Correct behaviour — the range clamps
    /// rather than inverting — but a useless picture of it.
    ///
    /// These snapshots are reviewed by eye and never byte-compared, so a live
    /// base that renders a real countdown beats a stable one that renders
    /// zeros. The clock times shift between runs as a result.
    private static let base = Date.now

    private var sampleState: TripContentState {
        TripContentState(
            leaveAt: Self.base.addingTimeInterval(12 * 60),
            arriveBy: Self.base.addingTimeInterval(36 * 60),
            routes: [.previewExpress, .previewTrolley]
        )
    }

    // MARK: - App screens

    @Test("App screens")
    func appScreens() {
        #expect(!SnapshotHarness.capture("screen-root") { RootView() }.isEmpty)

        #expect(!SnapshotHarness.capture("screen-probe") {
            NavigationStack { ProbeView() }
        }.isEmpty)

        #expect(!SnapshotHarness.capture("screen-live-activity") {
            NavigationStack { LiveActivityDemoView() }
        }.isEmpty)

        #expect(!SnapshotHarness.capture("screen-voice") {
            NavigationStack { WhisperTestView() }
        }.isEmpty)
    }

    // MARK: - Live Activity

    @Test("Live Activity lock screen, full colour")
    func liveActivityLockScreen() {
        let captured = SnapshotHarness.capture(
            "liveactivity-countdown",
            size: CGSize(width: 393, height: 140)
        ) {
            TripLockScreenView(attributes: .sample, state: sampleState)
        }
        #expect(!captured.isEmpty)
    }

    /// The lock screen strips colour. `WidgetRenderingMode` has exactly three
    /// cases — `fullColor`, `vibrant` and `accented` — and both non-colour
    /// modes have to stay legible, so both are rendered.
    @Test("Live Activity lock screen, vibrant and accented rendering")
    func liveActivityMonochrome() {
        for (name, mode) in [("vibrant", WidgetRenderingMode.vibrant),
                             ("accented", WidgetRenderingMode.accented)] {
            let captured = SnapshotHarness.capture(
                "liveactivity-countdown-\(name)",
                size: CGSize(width: 393, height: 140),
                renderer: .swiftUI      // contains knocked-out badges
            ) {
                TripLockScreenView(attributes: .sample, state: sampleState)
                    .environment(\.widgetRenderingMode, mode)
            }
            #expect(!captured.isEmpty)
        }
    }

    @Test("Live Activity, single leg")
    func liveActivitySingleLeg() {
        let state = TripContentState(
            leaveAt: Self.base.addingTimeInterval(5 * 60),
            arriveBy: Self.base.addingTimeInterval(24 * 60),
            routes: [.previewBus]
        )
        #expect(!SnapshotHarness.capture(
            "liveactivity-countdown-single",
            size: CGSize(width: 393, height: 140)
        ) {
            TripLockScreenView(attributes: .sample, state: state)
        }.isEmpty)
    }

    // MARK: - Dynamic Island

    @Test("Dynamic Island regions")
    func dynamicIslandRegions() {
        #expect(!SnapshotHarness.capture(
            "island-compact", size: CGSize(width: 220, height: 44)
        ) {
            HStack {
                TripIslandCompactLeading(state: sampleState)
                Spacer()
                TripIslandCompactTrailing(state: sampleState)
            }
            .padding(.horizontal, 12)
        }.isEmpty)

        #expect(!SnapshotHarness.capture(
            "island-minimal", size: CGSize(width: 60, height: 44)
        ) {
            TripIslandMinimal(state: sampleState)
        }.isEmpty)

        #expect(!SnapshotHarness.capture(
            "island-expanded", size: CGSize(width: 370, height: 160)
        ) {
            VStack(spacing: 12) {
                HStack(alignment: .top) {
                    TripIslandExpandedLeading(state: sampleState)
                    Spacer()
                    TripIslandExpandedTrailing(attributes: .sample, state: sampleState)
                }
                TripIslandExpandedBottom(state: sampleState)
            }
            .padding(16)
        }.isEmpty)
    }

    // MARK: - Route badges

    /// The signature element, in every category and size, in both the full
    /// colour context and the monochrome one.
    @Test("Route badges")
    func routeBadges() {
        // Real routes from the live feed, one per category, plus the longest
        // short name in it (`3G-A`) so clipping shows up in the render.
        let routes: [RouteRef] = [
            .previewBus, .previewExpress, .previewTrolley,
            .previewNight, .previewFerry, .previewLongest,
        ]

        for (label, size) in [("small", RouteBadge.Size.small),
                              ("regular", .regular),
                              ("large", .large)] {
            #expect(!SnapshotHarness.capture("badges-\(label)", size: nil) {
                HStack(spacing: 8) {
                    ForEach(routes) { RouteBadge($0, size: size) }
                }
                .padding(12)
            }.isEmpty)
        }

        // Must go through SwiftUI's renderer: the badge knocks the number out
        // of a filled shape with `blendMode(.destinationOut)`, and the window
        // path flattens CALayer compositing filters, so it draws a blank blob.
        // Confirmed by rendering both ways side by side — see decisions.md D10.
        for (name, mode) in [("vibrant", WidgetRenderingMode.vibrant),
                             ("accented", WidgetRenderingMode.accented)] {
            #expect(!SnapshotHarness.capture(
                "badges-\(name)", size: nil, renderer: .swiftUI
            ) {
                HStack(spacing: 8) {
                    ForEach(routes) { RouteBadge($0, size: .regular) }
                }
                .padding(12)
                .environment(\.widgetRenderingMode, mode)
            }.isEmpty)
        }

        // Badges have to survive accessibility type without clipping the
        // route number, which is the one thing on them that must stay legible.
        #expect(!SnapshotHarness.capture(
            "badges-accessibility", size: nil, variants: SnapshotHarness.Variant.accessibility
        ) {
            HStack(spacing: 8) {
                ForEach(routes) { RouteBadge($0, size: .regular) }
            }
            .padding(12)
        }.isEmpty)
    }

    @Test("Route summary with a transfer")
    func routeSummary() {
        #expect(!SnapshotHarness.capture("route-summary", size: nil) {
            RouteSummary(routes: [.previewExpress, .previewTrolley, .previewNight])
                .padding(12)
        }.isEmpty)
    }
}
