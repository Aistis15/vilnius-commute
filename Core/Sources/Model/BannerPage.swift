import Foundation

// The banner as data: what the page computes and both banners draw.
//
// Mirrors "The banner as data" in docs/ios-shell.md field for field, so the
// JSON the page posts decodes straight into these types. Times are epoch
// milliseconds, as JavaScript's Date.now() gives them, and stay numbers here
// rather than becoming `Date`: the same value is re-encoded by ActivityKit,
// and a number round-trips exactly.
//
// Decoding is lenient where the page might be newer than the app: an unknown
// stage or title kind falls back to a neutral one instead of failing the
// whole message (which would leave the old banner up with no explanation).

/// One page of the banner.
public struct BannerPage: Codable, Hashable, Sendable {

    public enum Stage: String, Codable, Hashable, Sendable, CaseIterable {
        case countdown, walk, wait, ride, problem, arrive, done

        public init(from decoder: any Decoder) throws {
            let raw = try decoder.singleValueContainer().decode(String.self)
            self = Stage(rawValue: raw) ?? .countdown
        }
    }

    public enum TitleKind: String, Codable, Hashable, Sendable {
        /// 32 pt semibold, tabular: "13:52".
        case clock
        /// 20 pt semibold: "Šv. Jurgio g.".
        case text
        /// 26 pt bold: "Ar baigėte kelionę?".
        case question
        /// 24 pt bold, in the palette's red: "Nespėsi persėsti".
        case problem

        public init(from decoder: any Decoder) throws {
            let raw = try decoder.singleValueContainer().decode(String.self)
            self = TitleKind(rawValue: raw) ?? .text
        }
    }

    /// The small glyph before the meta line.
    public enum MetaIcon: Codable, Hashable, Sendable {
        /// A turn arrow at this angle in degrees, + = right.
        case turn(Double)
        /// A zebra crossing.
        case crossing

        private enum Keys: String, CodingKey { case turn }

        public init(from decoder: any Decoder) throws {
            if let single = try? decoder.singleValueContainer(),
               let word = try? single.decode(String.self) {
                guard word == "crossing" else {
                    throw DecodingError.dataCorruptedError(
                        in: single, debugDescription: "unknown meta icon \(word)")
                }
                self = .crossing
                return
            }
            let keyed = try decoder.container(keyedBy: Keys.self)
            self = .turn(try keyed.decode(Double.self, forKey: .turn))
        }

        public func encode(to encoder: any Encoder) throws {
            switch self {
            case .crossing:
                var single = encoder.singleValueContainer()
                try single.encode("crossing")
            case .turn(let angle):
                var keyed = encoder.container(keyedBy: Keys.self)
                try keyed.encode(angle, forKey: .turn)
            }
        }
    }

    /// The number block on the right: "Liko" / "12" / "min".
    public struct Right: Codable, Hashable, Sendable {
        public var caption: String
        public var value: String
        public var unit: String?
        /// Epoch ms to count down to natively, so the number keeps moving
        /// while the app is asleep.
        public var until: Double?

        public init(caption: String, value: String, unit: String? = nil, until: Double? = nil) {
            self.caption = caption
            self.value = value
            self.unit = unit
            self.until = until
        }
    }

    /// The one line along the bottom.
    public struct Foot: Codable, Hashable, Sendable {
        public var routes: [Route]?
        public var text: String?
        /// 0...1.
        public var progress: Double?
        /// Stop positions along the progress line, 0...1.
        public var ticks: [Double]?

        public init(routes: [Route]? = nil, text: String? = nil,
                    progress: Double? = nil, ticks: [Double]? = nil) {
            self.routes = routes
            self.text = text
            self.progress = progress
            self.ticks = ticks
        }
    }

    public struct Button: Codable, Hashable, Sendable {
        public var label: String
        /// `trip-done`, `trip-snooze` or `replan`.
        public var action: String
        public var primary: Bool?

        public init(label: String, action: String, primary: Bool? = nil) {
            self.label = label
            self.action = action
            self.primary = primary
        }

        public var isPrimary: Bool { primary ?? false }
    }

    /// A route badge's name and colours, six hex digits each.
    public struct Route: Codable, Hashable, Sendable {
        public var name: String
        public var color: String
        public var text: String

        public init(name: String, color: String, text: String = "FFFFFF") {
            self.name = name
            self.color = color
            self.text = text
        }
    }

    public var stage: Stage
    public var caption: String
    public var captionRoute: Route?
    public var title: String
    public var titleKind: TitleKind
    public var meta: String?
    public var metaIcon: MetaIcon?
    public var right: Right?
    public var foot: Foot?
    public var buttons: [Button]?

    public init(
        stage: Stage,
        caption: String,
        captionRoute: Route? = nil,
        title: String,
        titleKind: TitleKind,
        meta: String? = nil,
        metaIcon: MetaIcon? = nil,
        right: Right? = nil,
        foot: Foot? = nil,
        buttons: [Button]? = nil
    ) {
        self.stage = stage
        self.caption = caption
        self.captionRoute = captionRoute
        self.title = title
        self.titleKind = titleKind
        self.meta = meta
        self.metaIcon = metaIcon
        self.right = right
        self.foot = foot
        self.buttons = buttons
    }

    private enum CodingKeys: String, CodingKey {
        case stage, caption, captionRoute, title, titleKind, meta, metaIcon, right, foot, buttons
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        stage = try c.decodeIfPresent(Stage.self, forKey: .stage) ?? .countdown
        caption = try c.decodeIfPresent(String.self, forKey: .caption) ?? ""
        captionRoute = try c.decodeIfPresent(Route.self, forKey: .captionRoute)
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        titleKind = try c.decodeIfPresent(TitleKind.self, forKey: .titleKind) ?? .text
        meta = try c.decodeIfPresent(String.self, forKey: .meta)
        // An icon this app does not know is dropped, not fatal.
        metaIcon = try? c.decodeIfPresent(MetaIcon.self, forKey: .metaIcon)
        right = try c.decodeIfPresent(Right.self, forKey: .right)
        foot = try c.decodeIfPresent(Foot.self, forKey: .foot)
        buttons = try c.decodeIfPresent([Button].self, forKey: .buttons)
    }

    /// The route the island shows: the caption's badge, else the first one
    /// on the bottom line.
    public var leadRoute: Route? {
        captionRoute ?? foot?.routes?.first
    }

    /// When `right.until` is set, a range `Text(timerInterval:)` can draw.
    ///
    /// `Text(timerInterval:)` traps on an empty or inverted range, which is
    /// what an `until` in the past would give while the banner is still up.
    /// Clamping the upper bound keeps it drawable at 0:00.
    public func countdownRange(now: Date = .now) -> ClosedRange<Date>? {
        guard let until = right?.until else { return nil }
        let end = Date(timeIntervalSince1970: until / 1000)
        return now...max(end, now)
    }
}

/// The user's colourway: three colours chosen together, plus the red that
/// still reads as a problem on that base. `#RRGGBB` each.
public struct BannerPalette: Codable, Hashable, Sendable {
    public var base: String
    public var ink: String
    public var accent: String
    public var red: String

    public init(base: String, ink: String, accent: String, red: String) {
        self.base = base
        self.ink = ink
        self.accent = accent
        self.red = red
    }

    /// The default colourway.
    public static let grafitas = BannerPalette(base: "#1C1C1E", ink: "#FFFFFF", accent: "#FFFFFF", red: "#FF453A")
    public static let smelis = BannerPalette(base: "#E6D8C4", ink: "#33271E", accent: "#8A5E3B", red: "#B00020")
    public static let balta = BannerPalette(base: "#F5F5F7", ink: "#1C1C1E", accent: "#1C1C1E", red: "#D70015")
    /// The Dynamic Island is always black with white ink: the colourway
    /// lives on the lock screen only.
    public static let island = BannerPalette(base: "#000000", ink: "#FFFFFF", accent: "#FFFFFF", red: "#FF453A")

    /// Which of ink, base, black and white reads best on the accent: what
    /// goes on the primary button and the page corner. The same rule, in the
    /// same order, as the design (ties keep the earlier one).
    public var onAccent: String {
        var best = ink
        var bestRatio = -1.0
        for candidate in [ink, base, "#000000", "#FFFFFF"] {
            let ratio = Self.contrast(candidate, accent)
            if ratio > bestRatio {
                best = candidate
                bestRatio = ratio
            }
        }
        return best
    }

    /// WCAG contrast ratio of two `#RRGGBB` colours.
    public static func contrast(_ a: String, _ b: String) -> Double {
        let x = luminance(a), y = luminance(b)
        return (max(x, y) + 0.05) / (min(x, y) + 0.05)
    }

    static func luminance(_ hex: String) -> Double {
        let channels = rgb(hex).map { value -> Double in
            let s = value / 255
            return s <= 0.03928 ? s / 12.92 : pow((s + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
    }

    static func rgb(_ hex: String) -> [Double] {
        guard let normalized = TransitPalette.normalizeHex(hex),
              let value = UInt32(normalized, radix: 16)
        else { return [0, 0, 0] }
        return [Double((value >> 16) & 0xFF), Double((value >> 8) & 0xFF), Double(value & 0xFF)]
    }
}

/// The banner from `at` on: what it will say after each change still ahead
/// (leave, board, get off, arrive), so the shell can switch to it while the
/// page is asleep.
public struct BannerMoment: Codable, Hashable, Sendable {
    /// Epoch ms.
    public var at: Double
    public var pages: [BannerPage]

    public init(at: Double, pages: [BannerPage]) {
        self.at = at
        self.pages = pages
    }

    public var date: Date { Date(timeIntervalSince1970: at / 1000) }
}

/// `{type: "activity", ...}` as the page posts it.
public struct ActivityMessage: Codable, Hashable, Sendable {
    public enum Op: String, Codable, Sendable { case start, update, end }

    public var op: Op
    public var destination: String?
    public var palette: BannerPalette?
    public var moments: [BannerMoment]?
    public var page: Int?

    public init(op: Op, destination: String? = nil, palette: BannerPalette? = nil,
                moments: [BannerMoment]? = nil, page: Int? = nil) {
        self.op = op
        self.destination = destination
        self.palette = palette
        self.moments = moments
        self.page = page
    }
}
