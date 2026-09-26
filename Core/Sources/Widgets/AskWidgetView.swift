import SwiftUI
import WidgetKit

/// The plainest possible widget: the question the product starts from.
///
/// Its first job is diagnostic. A home-screen or lock-screen widget is listed
/// in the system's widget gallery only once iOS has registered the extension
/// that provides it. So finding "Vilnius" in that gallery — or not finding it
/// — settles whether the extension is registered at all, separately from
/// anything specific to Live Activities or controls. Those two failures have
/// different fixes, and until now nothing on the phone could tell them apart.
///
/// Tapping it opens the app, which is where search will live.
public struct AskWidgetView: View {
    private let family: WidgetFamily

    public init(family: WidgetFamily) {
        self.family = family
    }

    public var body: some View {
        switch family {
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 0) {
                Text("Vilnius")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text("Kur keliausime?")
                    .font(.headline)
                    .lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

        default:
            VStack(alignment: .leading, spacing: 4) {
                Text("Vilnius")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
                Text("Kur keliausime šiandien?")
                    .font(.title3.weight(.semibold))
                    .lineLimit(3)
                    .minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
    }
}
