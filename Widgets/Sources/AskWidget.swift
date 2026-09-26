import Core
import SwiftUI
import WidgetKit

/// Home-screen and lock-screen widget asking where to go.
///
/// Static on purpose: one entry, never refreshed. Its value right now is that
/// it exists in the gallery at all — see ``AskWidgetView``.
struct AskWidget: Widget {
    static let kind = "com.vilniuscommute.app.ask"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: AskProvider()) { _ in
            AskEntryView()
        }
        .configurationDisplayName("Vilnius")
        .description("Kur keliausime šiandien?")
        .supportedFamilies([.systemSmall, .accessoryRectangular])
    }
}

private struct AskEntryView: View {
    @Environment(\.widgetFamily) private var family

    var body: some View {
        AskWidgetView(family: family)
            .containerBackground(for: .widget) { Color.cardBackground }
    }
}

struct AskEntry: TimelineEntry {
    let date: Date
}

struct AskProvider: TimelineProvider {
    func placeholder(in context: Context) -> AskEntry {
        AskEntry(date: .now)
    }

    func getSnapshot(in context: Context, completion: @escaping (AskEntry) -> Void) {
        completion(AskEntry(date: .now))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<AskEntry>) -> Void) {
        completion(Timeline(entries: [AskEntry(date: .now)], policy: .never))
    }
}
