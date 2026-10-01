import SwiftUI
import Testing
import WidgetKit

@testable import Core
@testable import VilniusCommute

/// Renders every surface to PNG so the UI can be reviewed without a Mac.
/// These are not assertions about pixels — nothing is compared against a
/// stored reference. Their job is to produce evidence a human looks at, which
/// is the only visual QA available when the development machine is Windows.
///
/// The files land in `artifacts/snapshots/` and CI uploads them.
@MainActor
@Suite("Snapshots", .serialized)
struct SnapshotTests {

    // MARK: - App screens

    @Test("App screens")
    func appScreens() {
        // No address saved on the simulator: the root is the setup screen.
        #expect(!SnapshotHarness.capture("screen-root") { RootView() }.isEmpty)

        #expect(!SnapshotHarness.capture("screen-setup") {
            ShellSetupView(initialAddress: "") { _ in true }
        }.isEmpty)

        #expect(!SnapshotHarness.capture("screen-failure") {
            ShellFailureView(onRetry: {}, onChangeAddress: {})
        }.isEmpty)

        #expect(!SnapshotHarness.capture("screen-probe") {
            NavigationStack { ProbeView() }
        }.isEmpty)

        #expect(!SnapshotHarness.capture("screen-diagnostics") {
            NavigationStack { DiagnosticsView(onChangeAddress: {}) }
        }.isEmpty)

        #expect(!SnapshotHarness.capture("screen-live-activity") {
            NavigationStack { LiveActivityDemoView() }
        }.isEmpty)

        #expect(!SnapshotHarness.capture("screen-voice") {
            NavigationStack { WhisperTestView() }
        }.isEmpty)
    }

    // MARK: - Live Activity

    /// The banner on the boards' backdrop (#2B2D31, a 16 pt frame), so a
    /// render can be laid next to its board.
    private func banner(_ name: String, _ state: TripContentState) -> [URL] {
        SnapshotHarness.capture(
            name,
            size: CGSize(width: 393, height: 172),
            variants: SnapshotHarness.Variant.banner
        ) {
            TripBannerView(state: state)
                .frame(width: 361)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(hex: "2B2D31") ?? .gray)
        }
    }

    @Test("Banner, every stage, Grafitas")
    func bannerStages() {
        for (name, page) in BannerSamples.stages {
            #expect(!banner("banner-\(name)-grafitas", BannerSamples.state(page)).isEmpty)
        }
    }

    @Test("Banner colourways")
    func bannerColourways() {
        #expect(!banner("banner-countdown-smelis",
                        BannerSamples.state(BannerSamples.countdown, palette: .smelis)).isEmpty)
        #expect(!banner("banner-countdown-balta",
                        BannerSamples.state(BannerSamples.countdown, palette: .balta)).isEmpty)
        // Lock-Trip.png: the walk in Smėlis.
        #expect(!banner("banner-walk-smelis",
                        BannerSamples.state(BannerSamples.walk, palette: .smelis)).isEmpty)
    }

    /// With `right.until` the number is `Text(timerInterval:)`, which keeps
    /// counting while the app sleeps; this shows how that reads.
    @Test("Banner with a live countdown")
    func bannerLiveCountdown() {
        var page = BannerSamples.countdown
        page.right?.until = Date.now.addingTimeInterval(12 * 60).timeIntervalSince1970 * 1000
        #expect(!banner("banner-countdown-timer", BannerSamples.state(page)).isEmpty)
    }

    // MARK: - Dynamic Island

    @Test("Dynamic Island")
    func dynamicIsland() {
        let state = BannerSamples.state(BannerSamples.countdown)
        let backdrop = Color(hex: "2B2D31") ?? .gray

        // Compact: 240 × 37, the badge and "12 min", padded 12 / 14.
        #expect(!SnapshotHarness.capture(
            "island-compact", size: CGSize(width: 280, height: 60),
            variants: SnapshotHarness.Variant.banner
        ) {
            HStack {
                TripIslandCompactLeading(state: state)
                Spacer()
                TripIslandCompactTrailing(state: state)
            }
            .padding(.leading, 12)
            .padding(.trailing, 14)
            .frame(width: 240, height: 37)
            .background(Capsule().fill(Color.black))
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(backdrop)
        }.isEmpty)

        // Minimal: the 37 pt circle beside the island; the walk has progress.
        #expect(!SnapshotHarness.capture(
            "island-minimal", size: CGSize(width: 120, height: 60),
            variants: SnapshotHarness.Variant.banner
        ) {
            HStack(spacing: 16) {
                TripIslandMinimal(state: state)
                    .frame(width: 37, height: 37)
                    .background(Circle().fill(Color.black))
                TripIslandMinimal(state: BannerSamples.state(BannerSamples.ride))
                    .frame(width: 37, height: 37)
                    .background(Circle().fill(Color.black))
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(backdrop)
        }.isEmpty)

        for (name, page) in [("countdown", BannerSamples.countdown),
                             ("ride", BannerSamples.ride),
                             ("arrive", BannerSamples.arrive)] {
            #expect(!SnapshotHarness.capture(
                "island-expanded-\(name)", size: CGSize(width: 403, height: 200),
                variants: SnapshotHarness.Variant.banner
            ) {
                TripIslandExpandedView(state: BannerSamples.state(page))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(backdrop)
            }.isEmpty)
        }
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

    // MARK: - Widgets

    /// Canvas sizes approximate the small home-screen widget and the
    /// lock-screen rectangular slot. The exact slots vary by device; these
    /// are for reviewing by eye, not for pixel parity.
    @Test("Ask widget")
    func askWidget() {
        #expect(!SnapshotHarness.capture("widget-ask-small", size: CGSize(width: 170, height: 170)) {
            AskWidgetView(family: .systemSmall)
                .padding(16)
                .background(Color.cardBackground)
        }.isEmpty)
        #expect(!SnapshotHarness.capture("widget-ask-rectangular", size: CGSize(width: 172, height: 76)) {
            AskWidgetView(family: .accessoryRectangular)
        }.isEmpty)
    }
}

/// The shell's address rules, which decide whether the page loads at all.
@Suite("Shell address")
struct ShellAddressTests {

    @Test("A bare address becomes http on port 8765")
    func bareAddress() {
        #expect(ShellAddress.parse("192.168.1.23")?.absoluteString == "http://192.168.1.23:8765")
        #expect(ShellAddress.parse(" 192.168.1.23:8765 ")?.absoluteString == "http://192.168.1.23:8765")
        #expect(ShellAddress.parse("http://192.168.1.23:8765/")?.absoluteString == "http://192.168.1.23:8765")
        #expect(ShellAddress.parse("192.168.1.23:9000")?.absoluteString == "http://192.168.1.23:9000")
    }

    @Test("A tunnel keeps https and its own port, and does not stream")
    func tunnel() throws {
        let url = try #require(ShellAddress.parse("https://abc-def.trycloudflare.com"))
        #expect(url.absoluteString == "https://abc-def.trycloudflare.com")
        #expect(!ShellAddress.streams(url))
        #expect(ShellAddress.streams(try #require(ShellAddress.parse("192.168.1.23"))))
        #expect(ShellAddress.page(for: url)?.absoluteString == "https://abc-def.trycloudflare.com/?shell=ios")
    }

    @Test("Not an address")
    func notAnAddress() {
        #expect(ShellAddress.parse("") == nil)
        #expect(ShellAddress.parse("ftp://x") == nil)
        #expect(ShellAddress.parse("192.168 .1.23") == nil)
    }

    @Test("The connect link carries a percent-encoded address")
    func connectLink() throws {
        let link = try #require(URL(string: "vilniuscommute://connect?url=http%3A%2F%2F192.168.1.23%3A8765"))
        #expect(ShellAddress.fromConnectLink(link)?.absoluteString == "http://192.168.1.23:8765")
        #expect(ShellAddress.fromConnectLink(URL(string: "vilniuscommute://trip")!) == nil)
    }

    @Test("Origins compare with default ports spelled out")
    func origins() {
        #expect(ShellAddress.origin(of: URL(string: "https://a.example/x")!)
                == ShellAddress.origin(of: URL(string: "https://A.example:443/")!))
        #expect(ShellAddress.origin(of: URL(string: "http://192.168.1.23:8765/api")!)
                != ShellAddress.origin(of: URL(string: "http://192.168.1.23:8766/")!))
    }

    @Test("The injected script carries the shell's kind and stream flag")
    func script() {
        let source = ShellScript.source(saved: ["a": "</script>"], insets: .zero, stream: false)
        #expect(source.contains("kind: 'ios'"))
        #expect(source.contains("stream: false"))
        #expect(source.contains("window.webkit.messageHandlers.vc.postMessage"))
        #expect(!source.contains("</script>"))
    }
}
