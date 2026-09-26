import Foundation

/// Reads what a bundle was *actually* signed with, from the binary itself.
///
/// This exists because the build is unsigned and Sideloadly signs it on a
/// Windows machine, out of sight. The provisioning profile only says what a
/// bundle is *allowed* to do; the signature says what it *claims*. iOS refuses
/// to run an extension whose signature claims an identity or entitlement its
/// profile does not grant — and for an app extension that refusal is silent:
/// the app installs, the extension sits on disk, and nothing appears. Reading
/// both, on the device, turns that silence into a line in the report.
///
/// Layout, from XNU's `osfmk/kern/cs_blobs.h`: `LC_CODE_SIGNATURE` points at an
/// embedded-signature SuperBlob (all fields big-endian), whose index lists
/// slots by type; slot 5 holds the entitlements as an XML plist.
public enum CodeSignature {

    public enum ReadError: Error, Equatable {
        case notMachO
        /// A universal binary. Builds here are thin arm64, so one means
        /// something rewrote the binary unexpectedly.
        case universal
        /// No `LC_CODE_SIGNATURE` at all — iOS will not run this.
        case unsigned
        case malformed(String)
        /// Signed, but with no entitlements slot.
        case noEntitlements
    }

    // Mach-O, little-endian on arm64.
    static let machOMagic64: UInt32 = 0xFEED_FACF
    static let fatMagic: UInt32 = 0xCAFE_BABE
    static let loadCodeSignature: UInt32 = 0x1D
    static let machHeader64Size = 32

    // Code signing blobs, big-endian.
    static let embeddedSignatureMagic: UInt32 = 0xFADE_0CC0
    static let entitlementsMagic: UInt32 = 0xFADE_7171
    static let entitlementsSlot: UInt32 = 5

    /// The entitlements dictionary embedded in a thin 64-bit Mach-O's
    /// signature.
    public static func entitlements(ofMachO data: Data) throws -> [String: Any] {
        let bytes = [UInt8](data)
        guard bytes.count >= machHeader64Size else { throw ReadError.notMachO }

        let magic = try bytes.uint32(at: 0, bigEndian: false)
        if magic == fatMagic || magic == fatMagic.byteSwapped { throw ReadError.universal }
        guard magic == machOMagic64 else { throw ReadError.notMachO }

        let commandCount = Int(try bytes.uint32(at: 16, bigEndian: false))
        var offset = machHeader64Size
        var signature: (offset: Int, size: Int)?

        for _ in 0..<commandCount {
            let command = try bytes.uint32(at: offset, bigEndian: false)
            let size = Int(try bytes.uint32(at: offset + 4, bigEndian: false))
            guard size >= 8 else { throw ReadError.malformed("load command size \(size)") }

            if command == loadCodeSignature {
                signature = (
                    Int(try bytes.uint32(at: offset + 8, bigEndian: false)),
                    Int(try bytes.uint32(at: offset + 12, bigEndian: false))
                )
                break
            }
            offset += size
        }

        guard let signature else { throw ReadError.unsigned }
        return try entitlements(inSuperBlob: bytes, at: signature.offset, size: signature.size)
    }

    static func entitlements(inSuperBlob bytes: [UInt8], at start: Int, size: Int) throws -> [String: Any] {
        guard start >= 0, size > 0, start + size <= bytes.count else {
            throw ReadError.malformed("signature outside the file")
        }
        guard try bytes.uint32(at: start, bigEndian: true) == embeddedSignatureMagic else {
            throw ReadError.malformed("not an embedded signature")
        }

        let count = Int(try bytes.uint32(at: start + 8, bigEndian: true))
        for index in 0..<count {
            let entry = start + 12 + index * 8
            let type = try bytes.uint32(at: entry, bigEndian: true)
            guard type == entitlementsSlot else { continue }

            let blob = start + Int(try bytes.uint32(at: entry + 4, bigEndian: true))
            guard try bytes.uint32(at: blob, bigEndian: true) == entitlementsMagic else {
                throw ReadError.malformed("entitlements slot has the wrong magic")
            }
            let length = Int(try bytes.uint32(at: blob + 4, bigEndian: true))
            guard length >= 8, blob + length <= bytes.count else {
                throw ReadError.malformed("entitlements length \(length)")
            }

            let xml = Data(bytes[(blob + 8)..<(blob + length)])
            guard let plist = try? PropertyListSerialization.propertyList(from: xml, options: [], format: nil)
                    as? [String: Any]
            else { throw ReadError.malformed("entitlements are not a plist") }
            return plist
        }
        throw ReadError.noEntitlements
    }
}

// MARK: - Provisioning profile

/// The parts of an `embedded.mobileprovision` that decide whether iOS will run
/// a bundle.
public struct ProvisioningProfile: Sendable, Equatable {
    public let name: String?
    public let uuid: String?
    public let applicationIdentifier: String?
    public let entitlementKeys: Set<String>
    public let expirationDate: Date?

    /// A profile is CMS-wrapped, but the plist inside is plain text, so it can
    /// be sliced out without any crypto.
    public static func parse(_ data: Data) -> ProvisioningProfile? {
        guard let start = data.range(of: Data("<?xml".utf8)),
              let end = data.range(of: Data("</plist>".utf8), in: start.upperBound..<data.endIndex)
        else { return nil }

        guard let plist = try? PropertyListSerialization.propertyList(
            from: data[start.lowerBound..<end.upperBound], options: [], format: nil
        ) as? [String: Any] else { return nil }

        let entitlements = plist["Entitlements"] as? [String: Any] ?? [:]
        return ProvisioningProfile(
            name: plist["Name"] as? String,
            uuid: plist["UUID"] as? String,
            applicationIdentifier: entitlements["application-identifier"] as? String,
            entitlementKeys: Set(entitlements.keys),
            expirationDate: plist["ExpirationDate"] as? Date
        )
    }
}

// MARK: - Identifier matching

public enum SigningIdentity {

    /// Whether an `application-identifier` (`TEAMID.bundle.id`, or a wildcard
    /// such as `TEAMID.*`) covers a bundle id.
    ///
    /// Strips the team prefix and compares the rest exactly, rather than
    /// checking for a suffix: `TEAM.com.x.app` must not be taken to cover
    /// `com.x.app.widgets`, and that is precisely the mix-up being looked for.
    public static func applicationIdentifier(_ identifier: String, covers bundleID: String) -> Bool {
        guard let dot = identifier.firstIndex(of: ".") else { return false }
        let pattern = identifier[identifier.index(after: dot)...]
        if pattern == "*" { return true }
        if pattern.hasSuffix(".*") {
            return bundleID.hasPrefix(pattern.dropLast())
        }
        return pattern == bundleID
    }
}

// MARK: - Byte reading

extension [UInt8] {
    func uint32(at offset: Int, bigEndian: Bool) throws -> UInt32 {
        guard offset >= 0, offset + 4 <= count else {
            throw CodeSignature.ReadError.malformed("read past the end at \(offset)")
        }
        let b0 = UInt32(self[offset]), b1 = UInt32(self[offset + 1])
        let b2 = UInt32(self[offset + 2]), b3 = UInt32(self[offset + 3])
        return bigEndian
            ? b0 << 24 | b1 << 16 | b2 << 8 | b3
            : b3 << 24 | b2 << 16 | b1 << 8 | b0
    }
}
