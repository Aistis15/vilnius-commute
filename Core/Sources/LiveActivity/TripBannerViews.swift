import SwiftUI
import WidgetKit

// The Live Activity presentations, drawn from a `BannerPage`.
//
// They live in Core rather than in the widget extension so that CI snapshot
// tests can render them: a unit-test bundle cannot import an app extension.
// The extension assembles them into an ActivityConfiguration and nothing more.
//
// Sizes, colours and type are the design boards' (design/…/Banner.dc.html,
// Island.dc.html): the banner is 361 × 140 pt with a 24 pt radius, padded
// 14 / 16, and every number is tabular. CSS line heights become fixed frame
// heights, so the lines sit exactly where the boards put them.

// MARK: - What the buttons do

/// How the banner's controls become tappable.
///
/// The App Intents that turn the page or end the trip live in Shared/Intents,
/// which Core cannot see, so the extension hands in the wrappers. Snapshots
/// and in-app previews use `inert`, which draws the same pixels.
public struct BannerActions {
    /// Wraps the page corner.
    public var page: @MainActor (AnyView) -> AnyView
    /// Wraps one of the page's buttons.
    public var button: @MainActor (BannerPage.Button, AnyView) -> AnyView

    public init(
        page: @escaping @MainActor (AnyView) -> AnyView,
        button: @escaping @MainActor (BannerPage.Button, AnyView) -> AnyView
    ) {
        self.page = page
        self.button = button
    }

    public static var inert: BannerActions {
        BannerActions(page: { $0 }, button: { _, label in label })
    }
}

// MARK: - Colours

/// The palette as SwiftUI colours, with the design's derived inks.
struct BannerColors {
    let base: Color
    let ink: Color
    let accent: Color
    let red: Color
    let onAccent: Color
    /// Meta lines: ink at 80 %.
    let ink2: Color
    /// Captions: ink at 64 %.
    let ink3: Color
    /// Secondary buttons: ink at 22 %.
    let fill2: Color
    /// The progress track: ink at 20 %.
    let track: Color

    init(_ palette: BannerPalette) {
        let ink = Color(hex: palette.ink) ?? .white
        self.base = Color(hex: palette.base) ?? .black
        self.ink = ink
        self.accent = Color(hex: palette.accent) ?? .white
        self.red = Color(hex: palette.red) ?? .red
        self.onAccent = Color(hex: palette.onAccent) ?? .black
        self.ink2 = ink.opacity(0.8)
        self.ink3 = ink.opacity(0.64)
        self.fill2 = ink.opacity(0.22)
        self.track = ink.opacity(0.2)
    }
}

// MARK: - Lock screen

/// The banner on the lock screen, in the user's colourway.
public struct TripBannerView: View {
    private let state: TripContentState
    private let actions: BannerActions

    public init(state: TripContentState, actions: BannerActions = .inert) {
        self.state = state
        self.actions = actions
    }

    public static let height: CGFloat = 140

    public var body: some View {
        let colors = BannerColors(state.palette)
        let page = state.page
        ZStack(alignment: .bottomTrailing) {
            VStack(alignment: .leading, spacing: 0) {
                BannerTop(page: page, colors: colors)
                Spacer(minLength: 0)
                BannerBottom(page: page, colors: colors, actions: actions,
                             cornerRoom: state.hasPages)
            }
            .padding(.vertical, 14)
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)

            if state.hasPages {
                actions.page(AnyView(
                    PageCorner(index: state.pageIndex, count: state.pageCount, colors: colors)
                ))
                .accessibilityLabel("Kitas puslapis")
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: Self.height)
        .foregroundStyle(colors.ink)
        .background(colors.base)
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
    }
}

/// Caption, title and meta on the left; the number block on the right.
private struct BannerTop: View {
    let page: BannerPage
    let colors: BannerColors

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            left
                .frame(maxWidth: .infinity, alignment: .leading)
            if let right = page.right {
                NumberBlock(right: right, page: page, colors: colors, valueSize: 32, lineHeight: 35)
                    .fixedSize()
            }
        }
    }

    @ViewBuilder
    private var left: some View {
        // On the walk the meta line sits at the foot of the 84 pt block the
        // board gives the minimap, level with its bottom edge.
        if page.stage == .walk, page.meta != nil {
            VStack(alignment: .leading, spacing: 0) {
                captionRow
                BannerTitle(page: page, colors: colors, island: false)
                Spacer(minLength: 0)
                metaRow
            }
            .frame(height: 84, alignment: .topLeading)
        } else {
            VStack(alignment: .leading, spacing: 0) {
                captionRow
                if page.titleKind == .question, hasCaption {
                    Color.clear.frame(height: 2)
                }
                BannerTitle(page: page, colors: colors, island: false)
                metaRow
            }
        }
    }

    private var hasCaption: Bool { !page.caption.isEmpty || page.captionRoute != nil }

    @ViewBuilder
    private var captionRow: some View {
        if hasCaption {
            CaptionRow(page: page, colors: colors)
        }
    }

    @ViewBuilder
    private var metaRow: some View {
        if let meta = page.meta {
            MetaRow(meta: meta, icon: page.metaIcon, color: colors.ink2)
        }
    }
}

struct CaptionRow: View {
    let page: BannerPage
    let colors: BannerColors

    var body: some View {
        HStack(spacing: 6) {
            if !page.caption.isEmpty {
                Text(page.caption)
                    .font(.system(size: 13))
                    .monospacedDigit()
                    .foregroundStyle(colors.ink3)
                    .lineLimit(1)
            }
            if let route = page.captionRoute {
                BannerBadge(route: route)
            }
        }
        .frame(height: 18)
    }
}

/// The left's main line, in one of four kinds.
struct BannerTitle: View {
    let page: BannerPage
    let colors: BannerColors
    /// The island's sizes are a step smaller (Island.dc.html).
    let island: Bool

    var body: some View {
        let spec = Self.spec(page.titleKind, island: island)
        Text(page.title)
            .font(.system(size: spec.size, weight: spec.weight))
            .tracking(spec.tracking)
            .monospacedDigit()
            .foregroundStyle(page.titleKind == .problem ? colors.red : colors.ink)
            .lineLimit(1)
            .minimumScaleFactor(page.titleKind == .clock ? 1 : 0.8)
            .truncationMode(.tail)
            .frame(height: spec.lineHeight)
    }

    struct Spec {
        let size: CGFloat
        let lineHeight: CGFloat
        let weight: Font.Weight
        let tracking: CGFloat
    }

    static func spec(_ kind: BannerPage.TitleKind, island: Bool) -> Spec {
        switch (kind, island) {
        case (.clock, false):    Spec(size: 32, lineHeight: 35, weight: .semibold, tracking: -0.32)
        case (.text, false):     Spec(size: 20, lineHeight: 25, weight: .semibold, tracking: 0)
        case (.question, false): Spec(size: 26, lineHeight: 30, weight: .bold, tracking: -0.26)
        case (.problem, false):  Spec(size: 24, lineHeight: 28, weight: .bold, tracking: -0.24)
        case (.clock, true):     Spec(size: 28, lineHeight: 32, weight: .semibold, tracking: 0)
        case (.text, true):      Spec(size: 20, lineHeight: 25, weight: .semibold, tracking: 0)
        case (.question, true):  Spec(size: 22, lineHeight: 26, weight: .bold, tracking: -0.22)
        case (.problem, true):   Spec(size: 22, lineHeight: 26, weight: .bold, tracking: -0.22)
        }
    }
}

struct MetaRow: View {
    let meta: String
    let icon: BannerPage.MetaIcon?
    let color: Color

    var body: some View {
        HStack(spacing: 6) {
            if let icon {
                MetaGlyph(icon: icon, color: color)
            }
            Text(meta)
                .font(.system(size: 15))
                .monospacedDigit()
                .foregroundStyle(color)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .frame(height: 20)
    }
}

/// A turn arrow at the turn's angle, or a zebra crossing. 16 pt.
struct MetaGlyph: View {
    let icon: BannerPage.MetaIcon
    let color: Color

    var body: some View {
        Group {
            switch icon {
            case .turn(let angle):
                if angle <= -30 {
                    Image(systemName: "arrow.turn.up.left")
                } else if angle >= 30 {
                    Image(systemName: "arrow.turn.up.right")
                } else {
                    Image(systemName: "arrow.up").rotationEffect(.degrees(angle))
                }
            case .crossing:
                ZebraGlyph()
            }
        }
        .font(.system(size: 14, weight: .semibold))
        .foregroundStyle(color)
        .frame(width: 16, height: 16)
        .accessibilityHidden(true)
    }
}

/// Four bars across a road: the crossing ahead.
private struct ZebraGlyph: View {
    var body: some View {
        HStack(spacing: 2) {
            ForEach(0..<4, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 1).frame(width: 2.2, height: 13)
            }
        }
    }
}

/// "Liko" / "12 min", the same place on every page.
struct NumberBlock: View {
    let right: BannerPage.Right
    let page: BannerPage
    let colors: BannerColors
    let valueSize: CGFloat
    let lineHeight: CGFloat

    var body: some View {
        VStack(alignment: .trailing, spacing: 0) {
            Text(right.caption)
                .font(.system(size: 13))
                .monospacedDigit()
                .foregroundStyle(colors.ink3)
                .lineLimit(1)
                .frame(height: 18)
            NumberValue(right: right, page: page, size: valueSize, unitSize: valueSize >= 32 ? 20 : 17)
                .frame(height: lineHeight)
        }
    }
}

/// The value and its unit. With `until` the value counts down by itself.
struct NumberValue: View {
    let right: BannerPage.Right
    let page: BannerPage
    let size: CGFloat
    let unitSize: CGFloat

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 3) {
            Group {
                if let range = page.countdownRange() {
                    // Only Text(timerInterval:) keeps ticking once the app
                    // sleeps; a computed string would freeze, quietly wrong.
                    Text(timerInterval: range, countsDown: true, showsHours: false)
                        .fixedSize(horizontal: true, vertical: false)
                } else {
                    Text(right.value)
                }
            }
            .font(.system(size: size, weight: .semibold))
            .tracking(size >= 32 ? -0.32 : 0)
            .monospacedDigit()
            .lineLimit(1)
            .layoutPriority(1)

            if let unit = right.unit, !unit.isEmpty {
                Text(unit)
                    .font(.system(size: unitSize, weight: .semibold))
                    .lineLimit(1)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Bottom line

private struct BannerBottom: View {
    let page: BannerPage
    let colors: BannerColors
    let actions: BannerActions
    /// Leaves the page corner its 52 pt.
    let cornerRoom: Bool

    var body: some View {
        if let buttons = page.buttons, !buttons.isEmpty {
            HStack(spacing: 8) {
                ForEach(Array(buttons.enumerated()), id: \.offset) { _, button in
                    actions.button(button, AnyView(PillButton(button: button, colors: colors)))
                }
            }
            .padding(.trailing, cornerRoom ? 52 : 0)
        } else if let foot = page.foot {
            FootRow(foot: foot, colors: colors, chevron: colors.ink3)
                .frame(height: 28)
                .padding(.trailing, cornerRoom ? 52 : 0)
        }
    }
}

/// Badges, then the progress line or the text, 8 pt apart.
struct FootRow: View {
    let foot: BannerPage.Foot
    let colors: BannerColors
    let chevron: Color
    var badgeHeight: CGFloat = 18
    var textSize: CGFloat = 15
    var textWeight: Font.Weight = .regular
    var textColor: Color?

    var body: some View {
        HStack(spacing: 8) {
            if let routes = foot.routes, !routes.isEmpty {
                RouteChain(routes: routes, chevron: chevron, badgeHeight: badgeHeight)
            }
            if let progress = foot.progress {
                ProgressLine(progress: progress, ticks: foot.ticks ?? [], colors: colors)
            } else if let text = foot.text {
                Text(text)
                    .font(.system(size: textSize, weight: textWeight))
                    .monospacedDigit()
                    .foregroundStyle(textColor ?? colors.ink2)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity,
                           alignment: (foot.routes?.isEmpty ?? true) ? .leading : .trailing)
            }
        }
    }
}

/// Badges in travel order, a chevron between each.
struct RouteChain: View {
    let routes: [BannerPage.Route]
    let chevron: Color
    var badgeHeight: CGFloat = 18

    var body: some View {
        HStack(spacing: badgeHeight > 18 ? 6 : 8) {
            ForEach(Array(routes.enumerated()), id: \.offset) { index, route in
                if index > 0 {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(chevron)
                        .frame(width: 12, height: 12)
                        .accessibilityHidden(true)
                }
                BannerBadge(route: route, height: badgeHeight)
            }
        }
    }
}

/// 5 pt track at ink 20 %, filled in ink, the stops cut in the base colour.
struct ProgressLine: View {
    let progress: Double
    let ticks: [Double]
    let colors: BannerColors

    var body: some View {
        GeometryReader { proxy in
            let width = proxy.size.width
            ZStack(alignment: .leading) {
                Rectangle().fill(colors.track)
                Rectangle().fill(colors.ink)
                    .frame(width: width * Self.clamp(progress))
                ForEach(Array(ticks.enumerated()), id: \.offset) { _, tick in
                    Rectangle().fill(colors.base)
                        .frame(width: 2)
                        .offset(x: width * Self.clamp(tick) - 1)
                }
            }
            .clipShape(Capsule())
        }
        .frame(height: 5)
        .frame(maxWidth: .infinity)
        .accessibilityElement()
        .accessibilityValue("\(Int((Self.clamp(progress) * 100).rounded())) %")
    }

    static func clamp(_ value: Double) -> Double { min(1, max(0, value)) }
}

/// A 44 pt pill. Primary: the accent with the most legible ink on it.
struct PillButton: View {
    let button: BannerPage.Button
    let colors: BannerColors

    var body: some View {
        Text(button.label)
            .font(.system(size: 17, weight: .semibold))
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .foregroundStyle(button.isPrimary ? colors.onAccent : colors.ink)
            .frame(maxWidth: .infinity)
            .frame(height: 44)
            .background(Capsule().fill(button.isPrimary ? colors.accent : colors.fill2))
            .contentShape(Capsule())
    }
}

// MARK: - Page corner

/// The banner's bottom-right corner: a 56 pt quarter circle in the accent
/// colour, dots for the pages, the current one opaque.
struct PageCorner: View {
    let index: Int
    let count: Int
    let colors: BannerColors

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            UnevenRoundedRectangle(topLeadingRadius: 56, style: .circular)
                .fill(colors.accent)
            HStack(spacing: 4) {
                ForEach(0..<min(max(count, 1), 5), id: \.self) { dot in
                    Circle()
                        .fill(colors.onAccent)
                        .opacity(dot == index ? 1 : 0.35)
                        .frame(width: 5, height: 5)
                }
            }
            .padding(.trailing, 15)
            .padding(.bottom, 14)
        }
        .frame(width: 56, height: 56)
        .contentShape(Rectangle())
    }
}

// MARK: - Route badge

/// The banner's route badge: 18 pt tall, 5 pt radius, 12 pt bold, with an
/// inset hairline so a black or very dark route still shows its edge.
public struct BannerBadge: View {
    let route: BannerPage.Route
    let height: CGFloat

    public init(route: BannerPage.Route, height: CGFloat = 18) {
        self.route = route
        self.height = height
    }

    private var big: Bool { height > 18 }
    private var radius: CGFloat { big ? 6.7 : 5 }

    public var body: some View {
        Text(route.name)
            .font(.system(size: big ? 15 : 12, weight: .bold))
            .monospacedDigit()
            .lineLimit(1)
            .fixedSize()
            .foregroundStyle(Color(hex: route.text) ?? .white)
            .padding(.horizontal, big ? 6 : 4)
            .frame(minWidth: height, minHeight: height, maxHeight: height)
            .background(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .fill(Color(hex: route.color) ?? TransitPalette.fallbackBackground(for: .other))
            )
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.22), lineWidth: 1)
            )
            .accessibilityLabel("Maršrutas \(route.name)")
    }
}

// MARK: - Dynamic Island

/// What the island shows of a page. Always black with white ink.
///
/// When the bottom line names a clock time ("ISM 14:20") beside a clock
/// title ("Išeik 13:52"), the island sets the two clocks side by side and
/// moves the countdown to its bottom line ("Liko 12 min"), as the board does.
struct IslandLayout {
    struct Corner {
        let caption: String
        let value: String
        let unit: String?
        let counts: Bool
    }

    let topRight: Corner?
    let bottomText: String?
    /// Whether `bottomText` should end in the live countdown.
    let bottomCounts: Bool

    init(page: BannerPage) {
        if page.titleKind == .clock, let right = page.right, let text = page.foot?.text,
           let split = Self.splitClock(text) {
            topRight = Corner(caption: split.place, value: split.clock, unit: nil, counts: false)
            bottomText = page.countdownRange() == nil
                ? [right.caption, right.value, right.unit].compactMap { $0 }.joined(separator: " ")
                : right.caption
            bottomCounts = page.countdownRange() != nil
        } else {
            topRight = page.right.map {
                Corner(caption: $0.caption, value: $0.value, unit: $0.unit, counts: $0.until != nil)
            }
            bottomText = page.foot?.text
            bottomCounts = false
        }
    }

    /// "ISM 14:20" -> ("ISM", "14:20").
    static func splitClock(_ text: String) -> (place: String, clock: String)? {
        let parts = text.split(separator: " ")
        guard parts.count >= 2, let last = parts.last else { return nil }
        let clock = String(last)
        let pieces = clock.split(separator: ":")
        guard pieces.count == 2, pieces[1].count == 2,
              (1...2).contains(pieces[0].count),
              clock.allSatisfy({ $0.isNumber || $0 == ":" })
        else { return nil }
        return (parts.dropLast().joined(separator: " "), clock)
    }
}

/// Compact leading: the route badge, or a walker when there is none.
public struct TripIslandCompactLeading: View {
    private let state: TripContentState
    public init(state: TripContentState) { self.state = state }

    public var body: some View {
        if let route = state.page.leadRoute {
            BannerBadge(route: route)
        } else {
            Image(systemName: "figure.walk")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
        }
    }
}

/// Compact trailing: "12 min".
public struct TripIslandCompactTrailing: View {
    private let state: TripContentState
    public init(state: TripContentState) { self.state = state }

    public var body: some View {
        if let right = state.page.right {
            HStack(spacing: 4) {
                if let range = state.countdownRange() {
                    Text(timerInterval: range, countsDown: true, showsHours: false)
                        .fixedSize(horizontal: true, vertical: false)
                } else {
                    Text(right.value)
                }
                if let unit = right.unit, !unit.isEmpty {
                    Text(unit)
                }
            }
            .font(.system(size: 15, weight: .semibold))
            .monospacedDigit()
            .lineLimit(1)
            .foregroundStyle(.white)
        }
    }
}

/// Minimal: the badge, inside the trip's progress when there is one.
public struct TripIslandMinimal: View {
    private let state: TripContentState
    public init(state: TripContentState) { self.state = state }

    public var body: some View {
        ZStack {
            if let progress = state.page.foot?.progress {
                Circle().stroke(Color.white.opacity(0.22), lineWidth: 3)
                Circle()
                    .trim(from: 0, to: ProgressLine.clamp(progress))
                    .stroke(Color.white, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                    .rotationEffect(.degrees(-90))
            }
            if let route = state.page.leadRoute {
                Text(route.name)
                    .font(.system(size: 10, weight: .bold))
                    .tracking(-0.2)
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .foregroundStyle(Color(hex: route.text) ?? .white)
                    .frame(minWidth: 16, minHeight: 14, maxHeight: 14)
                    .padding(.horizontal, 1)
                    .background(RoundedRectangle(cornerRadius: 4)
                        .fill(Color(hex: route.color) ?? .gray))
                    .fixedSize()
            } else {
                Image(systemName: "figure.walk")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white)
            }
        }
        .padding(1.5)
    }
}

/// Expanded, top left: caption and title.
public struct TripIslandExpandedLeading: View {
    private let state: TripContentState
    public init(state: TripContentState) { self.state = state }

    public var body: some View {
        let colors = BannerColors(.island)
        VStack(alignment: .leading, spacing: 0) {
            if !state.page.caption.isEmpty || state.page.captionRoute != nil {
                CaptionRow(page: state.page, colors: colors)
            }
            BannerTitle(page: state.page, colors: colors, island: true)
        }
        .foregroundStyle(colors.ink)
    }
}

/// Expanded, top right: the number block, or the arrival clock.
public struct TripIslandExpandedTrailing: View {
    private let state: TripContentState
    public init(state: TripContentState) { self.state = state }

    public var body: some View {
        let colors = BannerColors(.island)
        if let corner = IslandLayout(page: state.page).topRight {
            VStack(alignment: .trailing, spacing: 0) {
                Text(corner.caption)
                    .font(.system(size: 13))
                    .monospacedDigit()
                    .foregroundStyle(colors.ink3)
                    .lineLimit(1)
                    .frame(height: 18)
                if corner.counts, let right = state.page.right {
                    NumberValue(right: right, page: state.page, size: 28, unitSize: 17)
                        .frame(height: 32)
                } else {
                    HStack(alignment: .firstTextBaseline, spacing: 3) {
                        Text(corner.value)
                            .font(.system(size: 28, weight: .semibold))
                            .monospacedDigit()
                        if let unit = corner.unit, !unit.isEmpty {
                            Text(unit).font(.system(size: 17, weight: .semibold))
                        }
                    }
                    .lineLimit(1)
                    .frame(height: 32)
                }
            }
            .foregroundStyle(colors.ink)
            .fixedSize()
        }
    }
}

/// Expanded, below: meta, progress, badges and the bottom line, buttons.
public struct TripIslandExpandedBottom: View {
    private let state: TripContentState
    private let actions: BannerActions

    public init(state: TripContentState, actions: BannerActions = .inert) {
        self.state = state
        self.actions = actions
    }

    public var body: some View {
        let colors = BannerColors(.island)
        let page = state.page
        let layout = IslandLayout(page: page)
        VStack(alignment: .leading, spacing: 0) {
            if let meta = page.meta {
                MetaRow(meta: meta, icon: page.metaIcon, color: colors.ink2)
            }
            Spacer(minLength: 8)
            if let progress = page.foot?.progress {
                ProgressLine(progress: progress, ticks: page.foot?.ticks ?? [], colors: colors)
            }
            if let buttons = page.buttons, !buttons.isEmpty {
                HStack(spacing: 8) {
                    ForEach(Array(buttons.enumerated()), id: \.offset) { _, button in
                        actions.button(button, AnyView(PillButton(button: button, colors: colors)))
                    }
                }
                .padding(.top, 12)
            } else if hasBottomRow(page: page, layout: layout) {
                HStack(spacing: 6) {
                    if let routes = page.foot?.routes, !routes.isEmpty {
                        RouteChain(routes: routes, chevron: Color.white.opacity(0.5), badgeHeight: 24)
                    }
                    Spacer(minLength: 8)
                    if let text = layout.bottomText {
                        HStack(spacing: 4) {
                            Text(text)
                            if layout.bottomCounts, let range = page.countdownRange() {
                                Text(timerInterval: range, countsDown: true, showsHours: false)
                                    .fixedSize(horizontal: true, vertical: false)
                                if let unit = page.right?.unit { Text(unit) }
                            }
                        }
                        .font(.system(size: 17, weight: .semibold))
                        .monospacedDigit()
                        .lineLimit(1)
                    }
                }
                .frame(height: 26)
                .padding(.top, 12)
            }
        }
        .foregroundStyle(colors.ink)
    }

    private func hasBottomRow(page: BannerPage, layout: IslandLayout) -> Bool {
        !(page.foot?.routes?.isEmpty ?? true) || layout.bottomText != nil
    }
}

/// The whole expanded island as one view: 371 pt wide, radius 44, padded
/// 18 / 24. The widget lays the same three parts into the island's regions;
/// this is what snapshots and in-app previews draw.
public struct TripIslandExpandedView: View {
    private let state: TripContentState
    public init(state: TripContentState) { self.state = state }

    public var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                TripIslandExpandedLeading(state: state)
                    .frame(maxWidth: .infinity, alignment: .leading)
                TripIslandExpandedTrailing(state: state)
            }
            TripIslandExpandedBottom(state: state)
        }
        .padding(.vertical, 18)
        .padding(.horizontal, 24)
        .frame(width: 371, height: 168)
        .background(Color.black)
        .clipShape(RoundedRectangle(cornerRadius: 44, style: .continuous))
    }
}
