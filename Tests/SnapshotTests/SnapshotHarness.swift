import SwiftUI
import UIKit

/// Renders SwiftUI views to PNG files that CI uploads as an artifact.
///
/// Why a real `UIWindow` and not `ImageRenderer`: `ImageRenderer` only draws
/// what SwiftUI itself lays out. `List` and `NavigationStack` are backed by
/// UIKit, so they come out blank — which would make every app-screen snapshot
/// a useless empty rectangle. Hosting the view in a key window and capturing
/// the hierarchy renders what the phone actually shows. This is the same
/// approach established snapshot-testing libraries take.
///
/// Files are written to `<repo>/artifacts/snapshots`, located from `#filePath`
/// so it works the same on a runner and on a developer machine.
enum SnapshotHarness {

    /// iPhone logical points. Not the exact size of any one device — the point
    /// is a consistent canvas across runs, not pixel parity with hardware.
    ///
    /// Deliberately not main-actor isolated: it is a default argument value,
    /// and an isolated default would not be usable from every call site.
    static let phone = CGSize(width: 393, height: 852)

    static let outputDirectory: URL = {
        // Tests/SnapshotTests/SnapshotHarness.swift -> repo root
        let repoRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()   // SnapshotTests
            .deletingLastPathComponent()   // Tests
            .deletingLastPathComponent()   // repo root
        let directory = repoRoot
            .appendingPathComponent("artifacts")
            .appendingPathComponent("snapshots")
        try? FileManager.default.createDirectory(
            at: directory, withIntermediateDirectories: true
        )
        return directory
    }()

    struct Variant {
        let suffix: String
        let colorScheme: ColorScheme
        let dynamicType: DynamicTypeSize

        /// The matrix the design rules call for: both appearances, and body
        /// text at default and at an accessibility size where layouts break.
        static let all: [Variant] = [
            Variant(suffix: "light-L",   colorScheme: .light, dynamicType: .large),
            Variant(suffix: "dark-L",    colorScheme: .dark,  dynamicType: .large),
            Variant(suffix: "light-XXL", colorScheme: .light, dynamicType: .xxLarge),
            Variant(suffix: "dark-XXL",  colorScheme: .dark,  dynamicType: .xxLarge),
        ]

        /// For elements whose job is to survive very large type.
        static let accessibility: [Variant] = [
            Variant(suffix: "light-AX3", colorScheme: .light, dynamicType: .accessibility3),
            Variant(suffix: "dark-AX3",  colorScheme: .dark,  dynamicType: .accessibility3),
        ]
    }

    /// Renders one view across a set of variants.
    ///
    /// - Parameter size: fixed canvas, or `nil` to size to the view's content
    ///   (used for badges and other small elements).
    @discardableResult
    @MainActor
    static func capture(
        _ name: String,
        size: CGSize? = phone,
        variants: [Variant] = Variant.all,
        @ViewBuilder content: () -> some View
    ) -> [URL] {
        var written: [URL] = []
        let view = content()

        for variant in variants {
            let image = render(view, size: size, variant: variant)
            guard let data = image.pngData() else { continue }
            let url = outputDirectory.appendingPathComponent("\(name)_\(variant.suffix).png")
            do {
                try data.write(to: url, options: .atomic)
                written.append(url)
            } catch {
                // Surfaced rather than swallowed: a snapshot that silently
                // fails to write looks identical to one that was never run.
                print("snapshot: failed to write \(url.lastPathComponent): \(error)")
            }
        }
        return written
    }

    @MainActor
    private static func render(
        _ view: some View,
        size: CGSize?,
        variant: Variant
    ) -> UIImage {
        let configured = view
            .environment(\.colorScheme, variant.colorScheme)
            .environment(\.dynamicTypeSize, variant.dynamicType)

        let controller = UIHostingController(rootView: configured)
        controller.view.backgroundColor = .systemBackground

        // A full-screen capture keeps the safe area, so it looks like a real
        // screen with room for the status bar. Anything smaller must not: the
        // window inherits a status-bar-sized top inset, which pushes the
        // content down and clips it straight out of the frame. That is what
        // decapitated every badge and Live Activity banner in the first run.
        //
        // Set before measuring — the inset changes the fitting size too.
        let isFullScreen = (size == phone)
        controller.safeAreaRegions = isFullScreen ? .all : []

        let target: CGSize
        if let size {
            target = size
        } else {
            // Intrinsic size, for small elements like badges.
            let fitted = controller.sizeThatFits(
                in: CGSize(width: CGFloat.greatestFiniteMagnitude,
                           height: CGFloat.greatestFiniteMagnitude)
            )
            target = CGSize(width: max(fitted.width, 1), height: max(fitted.height, 1))
        }

        let window = UIWindow(frame: CGRect(origin: .zero, size: target))
        // Keeps UIKit-backed backgrounds (List, navigation bars) in step with
        // the SwiftUI colour scheme; setting only the environment leaves them
        // in light mode.
        window.overrideUserInterfaceStyle = variant.colorScheme == .dark ? .dark : .light
        window.rootViewController = controller
        window.makeKeyAndVisible()

        controller.view.frame = window.bounds
        controller.view.setNeedsLayout()
        controller.view.layoutIfNeeded()

        // Let UIKit commit the layout before capture. Without this, collection
        // view backed content is captured mid-update and comes out empty.
        RunLoop.current.run(until: Date().addingTimeInterval(0.05))

        let renderer = UIGraphicsImageRenderer(size: target)
        return renderer.image { context in
            if !window.drawHierarchy(in: window.bounds, afterScreenUpdates: true) {
                // Fall back to layer rendering if the window was not on screen.
                window.layer.render(in: context.cgContext)
            }
        }
    }
}
