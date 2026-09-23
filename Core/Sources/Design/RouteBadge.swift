import SwiftUI
import WidgetKit

/// The signature element: a route number in its transit colour.
///
/// Colour is what separates bus 1 from trolleybus 1, so a badge is never drawn
/// without it — except on the lock screen. `WidgetRenderingMode` has exactly
/// three cases: `fullColor`, `vibrant` and `accented`. The latter two strip or
/// flatten colour, so anything that is not `fullColor` falls back to a filled
/// shape with the number knocked out of it, which survives tinting and stays
/// legible.
public struct RouteBadge: View {

    public enum Size: Sendable {
        case small      // widgets
        case regular    // lists
        case large      // Live Activity hero

        var height: CGFloat {
            switch self {
            case .small:   18
            case .regular: 24
            case .large:   34
            }
        }

        var fontSize: CGFloat {
            switch self {
            case .small:   12
            case .regular: 15
            case .large:   21
            }
        }

        /// Continuous corner radius, kept proportional to height so all three
        /// sizes read as the same shape.
        var radiusRatio: CGFloat { 0.28 }

        var horizontalPadding: CGFloat {
            switch self {
            case .small:   4
            case .regular: 6
            case .large:   8
            }
        }
    }

    private let route: RouteRef
    private let size: Size

    @Environment(\.widgetRenderingMode) private var renderingMode
    @ScaledMetric(relativeTo: .body) private var scale: CGFloat = 1

    public init(_ route: RouteRef, size: Size = .regular) {
        self.route = route
        self.size = size
    }

    private var height: CGFloat { size.height * scale }
    private var radius: CGFloat { height * size.radiusRatio }

    public var body: some View {
        Group {
            if renderingMode == .fullColor {
                colored
            } else {
                monochrome
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityLabel)
    }

    // MARK: - Full colour (app, Live Activity, Dynamic Island, home screen)

    private var colored: some View {
        boxed(number.foregroundStyle(route.foreground))
            .background(shape.fill(route.background))
    }

    // MARK: - Vibrant / accented (lock screen)

    /// The number is punched out of a solid shape rather than drawn on top of
    /// it. In vibrant rendering the system tints whatever is opaque, so a
    /// knocked-out glyph keeps its contrast whatever the tint turns out to be.
    ///
    /// The knock-out has to be a `ZStack` inside a single `compositingGroup`.
    /// An earlier version used `.blendMode(.destinationOut)` with
    /// `.background(…)`, which does **not** composite — the shape and the text
    /// end up in different layers, so the blend had nothing to erase and every
    /// badge rendered as a featureless white blob with no number on it.
    private var monochrome: some View {
        // A hidden copy of the number establishes the exact same geometry the
        // colour variant uses; the overlay then draws the real composite into
        // that frame.
        boxed(number.hidden())
            .overlay {
                ZStack {
                    shape.fill(.primary)
                    number.blendMode(.destinationOut)
                }
                .compositingGroup()
            }
    }

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
    }

    private var number: some View {
        Text(route.shortName)
            .font(.system(size: size.fontSize * scale, weight: .bold))
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.7)
    }

    /// The padded box the number sits in. Minimum width equals height, so a
    /// single digit is a square and longer numbers grow sideways only.
    private func boxed(_ content: some View) -> some View {
        content
            .padding(.horizontal, size.horizontalPadding * scale)
            .frame(minWidth: height, minHeight: height)
    }

    private var accessibilityLabel: String {
        switch route.category {
        case .bus:        "Autobusas \(route.shortName)"
        case .expressBus: "Greitasis autobusas \(route.shortName)"
        case .nightBus:   "Naktinis autobusas \(route.shortName)"
        case .trolleybus: "Troleibusas \(route.shortName)"
        case .other:      "Maršrutas \(route.shortName)"
        }
    }
}

#Preview("Badges") {
    VStack(alignment: .leading, spacing: 16) {
        HStack(spacing: 8) {
            RouteBadge(.previewBus, size: .large)
            RouteBadge(.previewExpress, size: .large)
            RouteBadge(.previewTrolley, size: .large)
            RouteBadge(.previewNight, size: .large)
        }
        HStack(spacing: 8) {
            RouteBadge(.previewBus)
            RouteBadge(.previewExpress)
            RouteBadge(.previewTrolley)
            RouteBadge(.previewNight)
        }
        HStack(spacing: 8) {
            RouteBadge(.previewBus, size: .small)
            RouteBadge(.previewExpress, size: .small)
            RouteBadge(.previewTrolley, size: .small)
            RouteBadge(.previewNight, size: .small)
        }
    }
    .padding()
}

public extension RouteRef {
    // Sample values for previews and snapshots. Colours are the spec's
    // fallback table, NOT verified against the live feed — Phase 2 replaces
    // these with real rows from routes.txt.
    static let previewBus     = RouteRef(routeID: "preview_bus_1",      shortName: "1",   category: .bus)
    static let previewExpress = RouteRef(routeID: "preview_express_3G", shortName: "3G",  category: .expressBus)
    static let previewTrolley = RouteRef(routeID: "preview_trol_2",     shortName: "2",   category: .trolleybus)
    static let previewNight   = RouteRef(routeID: "preview_night_101N", shortName: "101N", category: .nightBus)
}
