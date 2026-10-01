import Foundation

/// Where the page comes from: the PC running `prototype/server.py`.
///
/// Kept in `UserDefaults` under `serverURL` (docs/ios-shell.md), e.g.
/// `http://192.168.1.23:8765` or `https://….trycloudflare.com`.
enum ShellAddress {

    static let defaultsKey = "serverURL"
    static let defaultPort = 8765

    static var saved: URL? {
        get {
            UserDefaults.standard.string(forKey: defaultsKey).flatMap(URL.init(string:))
        }
        set {
            if let newValue {
                UserDefaults.standard.set(newValue.absoluteString, forKey: defaultsKey)
            } else {
                UserDefaults.standard.removeObject(forKey: defaultsKey)
            }
        }
    }

    /// What someone typed, as a server address.
    ///
    /// `192.168.1.23` and `192.168.1.23:8765` and `http://192.168.1.23:8765/`
    /// all become `http://192.168.1.23:8765`: without a scheme it is http,
    /// and plain http without a port is the server's 8765. An https address
    /// (a tunnel) keeps its own default port. Query and fragment are dropped;
    /// a path is kept, without its trailing slash.
    static func parse(_ raw: String) -> URL? {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !text.contains(" ") else { return nil }
        if !text.contains("://") { text = "http://" + text }
        guard var parts = URLComponents(string: text),
              let scheme = parts.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = parts.host, !host.isEmpty
        else { return nil }
        parts.scheme = scheme
        parts.host = host.lowercased()
        if parts.port == nil, scheme == "http" { parts.port = defaultPort }
        parts.query = nil
        parts.fragment = nil
        while parts.path.hasSuffix("/") { parts.path.removeLast() }
        return parts.url
    }

    /// The page itself: `<serverURL>/?shell=ios`.
    static func page(for server: URL) -> URL? {
        URL(string: server.absoluteString + "/?shell=ios")
    }

    /// Server-sent events do not pass Cloudflare quick tunnels, so the page
    /// is told to poll there instead.
    static func streams(_ server: URL) -> Bool {
        !(server.host?.lowercased().hasSuffix("trycloudflare.com") ?? false)
    }

    /// `scheme://host:port`, with the scheme's default port spelled out, so
    /// two spellings of one origin compare equal.
    static func origin(of url: URL) -> String? {
        guard let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased() else { return nil }
        let port = url.port ?? (scheme == "https" ? 443 : scheme == "http" ? 80 : -1)
        return "\(scheme)://\(host):\(port)"
    }

    /// The address in `vilniuscommute://connect?url=<percent-encoded>`.
    static func fromConnectLink(_ url: URL) -> URL? {
        guard url.scheme?.lowercased() == "vilniuscommute",
              url.host?.lowercased() == "connect",
              let value = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "url" })?.value
        else { return nil }
        return parse(value)
    }

    /// How the address is shown back in the field: without `http://`.
    static func display(_ url: URL) -> String {
        let text = url.absoluteString
        return text.hasPrefix("http://") ? String(text.dropFirst("http://".count)) : text
    }
}
