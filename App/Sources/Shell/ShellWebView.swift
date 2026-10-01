import SwiftUI
import UIKit
import WebKit

/// The page, full screen.
struct ShellWebView: UIViewRepresentable {
    let model: ShellModel
    let insets: ShellScript.Insets

    func makeUIView(context: Context) -> WKWebView {
        model.makeWebView(insets: insets)
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        model.updateInsets(insets)
    }
}

/// Navigation and messages for the page's web view.
@MainActor
final class ShellWebCoordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {

    private weak var model: ShellModel?

    init(model: ShellModel) {
        self.model = model
    }

    // MARK: - Messages

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let text = message.body as? String else { return }
        model?.received(text)
    }

    // MARK: - Where the view may go

    /// The view only navigates within its own origin; links to other sites
    /// open in Safari (`about:`, `data:` and `blob:` pages and sub-frames
    /// are allowed, as in the Expo shell).
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = navigationAction.request.url else { return .cancel }
        if navigationAction.targetFrame?.isMainFrame == false { return .allow }
        if let scheme = url.scheme?.lowercased(), ["about", "data", "blob"].contains(scheme) { return .allow }
        if let origin = model?.origin, ShellAddress.origin(of: url) == origin { return .allow }
        if url.scheme?.lowercased() == "vilniuscommute" {
            model?.open(url)
            return .cancel
        }
        _ = await UIApplication.shared.open(url)
        return .cancel
    }

    /// A server error on the page itself counts as not reaching it.
    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse) async -> WKNavigationResponsePolicy {
        if navigationResponse.isForMainFrame,
           let http = navigationResponse.response as? HTTPURLResponse, http.statusCode >= 500 {
            model?.pageFailed()
        }
        return .allow
    }

    /// `target="_blank"`: the same rule, in this view or in Safari.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            if let origin = model?.origin, ShellAddress.origin(of: url) == origin {
                webView.load(navigationAction.request)
            } else {
                UIApplication.shared.open(url)
            }
        }
        return nil
    }

    // MARK: - Loading

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        // A new document: its watchers start from nothing.
        model?.pageStarted()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        model?.pageLoaded()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error) {
        guard !Self.isCancel(error) else { return }
        model?.pageFailed()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: any Error) {
        guard !Self.isCancel(error) else { return }
        model?.pageFailed()
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        model?.pageCrashed()
    }

    /// A navigation replaced by another one, or one the policy cancelled.
    private static func isCancel(_ error: any Error) -> Bool {
        let error = error as NSError
        if error.domain == NSURLErrorDomain, error.code == NSURLErrorCancelled { return true }
        // WebKitErrorFrameLoadInterruptedByPolicyChange
        return error.domain == "WebKitErrorDomain" && error.code == 102
    }
}
