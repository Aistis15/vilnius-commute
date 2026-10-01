import Foundation

/// The design boards' sample trip (Banner-Stages), as banner data.
///
/// Used by snapshots, the in-app demo and the lock-screen control, which
/// shows a banner before the page has planned anything. The copy is the
/// boards' own, so a snapshot can be laid next to its board.
public enum BannerSamples {

    public static let route3G = BannerPage.Route(name: "3G", color: "008000", text: "FFFFFF")
    public static let route2 = BannerPage.Route(name: "2", color: "DC3131", text: "FFFFFF")

    public static let countdown = BannerPage(
        stage: .countdown,
        caption: "Išeik",
        title: "13:52",
        titleKind: .clock,
        right: BannerPage.Right(caption: "Liko", value: "12", unit: "min"),
        foot: BannerPage.Foot(routes: [route3G, route2], text: "ISM 14:20")
    )

    public static let walk = BannerPage(
        stage: .walk,
        caption: "Eik į stotelę",
        title: "Šv. Jurgio g.",
        titleKind: .text,
        meta: "Kairėn · po 70 m",
        metaIcon: .turn(-90),
        right: BannerPage.Right(caption: "3G atvyks", value: "4", unit: "min"),
        foot: BannerPage.Foot(progress: 0.35)
    )

    /// No board draws the wait; it is the walk's template with the
    /// prototype's words (`nowPage` in prototype/web/app.js).
    public static let wait = BannerPage(
        stage: .wait,
        caption: "Lauk stotelėje",
        captionRoute: route3G,
        title: "Šv. Jurgio g.",
        titleKind: .text,
        meta: "→ Saulėtekis",
        right: BannerPage.Right(caption: "Išvyksta po", value: "4", unit: "min"),
        foot: BannerPage.Foot(text: "3G už 2 stotelių")
    )

    public static let ride = BannerPage(
        stage: .ride,
        caption: "Važiuoji",
        captionRoute: route3G,
        title: "Persėsk į 2",
        titleKind: .text,
        meta: "Katedros a. · po 6 stotelių",
        right: BannerPage.Right(caption: "Išlipk už", value: "9", unit: "min"),
        foot: BannerPage.Foot(progress: 0.55, ticks: [0.2, 0.4, 0.6, 0.8])
    )

    public static let problem = BannerPage(
        stage: .problem,
        caption: "",
        title: "Nespėsi persėsti",
        titleKind: .problem,
        meta: "3G vėluoja 4 min",
        buttons: [BannerPage.Button(label: "Planuoti iš čia", action: "replan", primary: true)]
    )

    public static let arrive = BannerPage(
        stage: .arrive,
        caption: "ISM · 14:18",
        title: "Ar baigėte kelionę?",
        titleKind: .question,
        buttons: [
            BannerPage.Button(label: "Taip", action: "trip-done", primary: true),
            BannerPage.Button(label: "Dar ne", action: "trip-snooze"),
        ]
    )

    /// Every stage, in trip order, with its file-name word.
    public static let stages: [(name: String, page: BannerPage)] = [
        ("countdown", countdown), ("walk", walk), ("wait", wait),
        ("ride", ride), ("problem", problem), ("arrive", arrive),
    ]

    /// The three pages the countdown moment turns through on the boards.
    public static let pages: [BannerPage] = [countdown, walk, ride]

    /// A state as the boards show it: pages 1–3 have the corner, the rest not.
    public static func state(_ page: BannerPage, palette: BannerPalette = .grafitas) -> TripContentState {
        if let index = pages.firstIndex(of: page) {
            return TripContentState(page: page, pageIndex: index, pageCount: pages.count, palette: palette)
        }
        return TripContentState(page: page, pageIndex: 0, pageCount: 1, palette: palette)
    }

    /// Moments for the demo banner: leave now, then arrive in 25 minutes.
    public static func demoMoments(now: Date = .now) -> [BannerMoment] {
        let ms = now.timeIntervalSince1970 * 1000
        let leaveAt = now.addingTimeInterval(12 * 60)
        let arriveAt = now.addingTimeInterval(25 * 60)
        var leave = countdown
        leave.title = TimeFormat.clock(leaveAt)
        leave.right?.until = leaveAt.timeIntervalSince1970 * 1000
        leave.foot?.text = "ISM \(TimeFormat.clock(arriveAt))"
        var done = arrive
        done.caption = "ISM · \(TimeFormat.clock(arriveAt))"
        return [
            BannerMoment(at: ms, pages: [leave, walk, ride]),
            BannerMoment(at: arriveAt.timeIntervalSince1970 * 1000, pages: [done]),
        ]
    }
}
