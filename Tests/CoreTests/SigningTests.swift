import Foundation
import Testing

@testable import Core

/// The signing checks run on the phone, where a wrong answer costs a full
/// sideload round trip to discover. So the parsers are proven here first,
/// against binaries assembled byte by byte to the documented layout.
@Suite("Code signature reading")
struct CodeSignatureTests {

    private static let entitlementsXML = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0"><dict>
        <key>application-identifier</key><string>ABCDE12345.com.example.app.widgets</string>
        <key>get-task-allow</key><true/>
        </dict></plist>
        """

    @Test("Entitlements are read out of a signed thin Mach-O")
    func readsEntitlements() throws {
        let binary = MachOBuilder.signed(entitlements: Data(Self.entitlementsXML.utf8))
        let entitlements = try CodeSignature.entitlements(ofMachO: binary)
        #expect(entitlements["application-identifier"] as? String
                == "ABCDE12345.com.example.app.widgets")
        #expect(entitlements["get-task-allow"] as? Bool == true)
    }

    @Test("A binary without LC_CODE_SIGNATURE is reported as unsigned")
    func reportsUnsigned() {
        #expect(throws: CodeSignature.ReadError.unsigned) {
            try CodeSignature.entitlements(ofMachO: MachOBuilder.unsigned())
        }
    }

    @Test("A signature with no entitlements slot is told apart from no signature")
    func reportsMissingEntitlementsSlot() {
        #expect(throws: CodeSignature.ReadError.noEntitlements) {
            try CodeSignature.entitlements(ofMachO: MachOBuilder.signed(entitlements: nil))
        }
    }

    @Test("Universal and non-Mach-O files are rejected, not misread")
    func rejectsOtherFormats() {
        #expect(throws: CodeSignature.ReadError.universal) {
            try CodeSignature.entitlements(ofMachO: Data([0xCA, 0xFE, 0xBA, 0xBE] + [UInt8](repeating: 0, count: 60)))
        }
        #expect(throws: CodeSignature.ReadError.notMachO) {
            try CodeSignature.entitlements(ofMachO: Data("not a binary at all, just some text".utf8))
        }
    }

    @Test("A truncated binary throws instead of reading out of bounds")
    func survivesTruncation() {
        let binary = MachOBuilder.signed(entitlements: Data(Self.entitlementsXML.utf8))
        #expect(throws: CodeSignature.ReadError.self) {
            try CodeSignature.entitlements(ofMachO: binary.prefix(binary.count - 40))
        }
    }
}

@Suite("Provisioning profile")
struct ProvisioningProfileTests {

    @Test("The plist is found inside the CMS wrapper")
    func parsesWrappedPlist() throws {
        let plist = """
            <?xml version="1.0" encoding="UTF-8"?>
            <plist version="1.0"><dict>
            <key>Name</key><string>iOS Team Provisioning Profile: com.example.app</string>
            <key>UUID</key><string>11111111-2222-3333-4444-555555555555</string>
            <key>ExpirationDate</key><date>2026-10-03T12:00:00Z</date>
            <key>Entitlements</key><dict>
              <key>application-identifier</key><string>ABCDE12345.com.example.app</string>
              <key>get-task-allow</key><true/>
            </dict>
            </dict></plist>
            """
        // Stand-ins for the binary CMS envelope on either side.
        let wrapped = Data([0x30, 0x82, 0x1F, 0x00, 0x06, 0x09]) + Data(plist.utf8) + Data([0xA0, 0x82, 0x00])

        let profile = try #require(ProvisioningProfile.parse(wrapped))
        #expect(profile.applicationIdentifier == "ABCDE12345.com.example.app")
        #expect(profile.uuid == "11111111-2222-3333-4444-555555555555")
        #expect(profile.entitlementKeys == ["application-identifier", "get-task-allow"])
        #expect(profile.expirationDate != nil)
    }

    @Test("Bytes with no plist in them give nil, not a crash")
    func rejectsGarbage() {
        #expect(ProvisioningProfile.parse(Data([0x00, 0x01, 0x02])) == nil)
    }
}

@Suite("Application identifier matching")
struct SigningIdentityTests {

    @Test("An exact identifier covers its own bundle id only")
    func exactMatch() {
        #expect(SigningIdentity.applicationIdentifier("ABCDE12345.com.x.app", covers: "com.x.app"))
        // The mix-up the check exists to catch: the app's identity on the
        // extension.
        #expect(!SigningIdentity.applicationIdentifier("ABCDE12345.com.x.app", covers: "com.x.app.widgets"))
        #expect(!SigningIdentity.applicationIdentifier("ABCDE12345.com.x.app.widgets", covers: "com.x.app"))
    }

    @Test("Wildcards cover what they name")
    func wildcards() {
        #expect(SigningIdentity.applicationIdentifier("ABCDE12345.*", covers: "com.x.app.widgets"))
        #expect(SigningIdentity.applicationIdentifier("ABCDE12345.com.x.*", covers: "com.x.app"))
        #expect(!SigningIdentity.applicationIdentifier("ABCDE12345.com.y.*", covers: "com.x.app"))
    }

    @Test("An identifier with no team prefix covers nothing")
    func malformed() {
        #expect(!SigningIdentity.applicationIdentifier("com", covers: "com"))
    }
}

// MARK: - Test binaries

/// Assembles minimal Mach-O files to the layout in XNU's `mach-o/loader.h`
/// (little-endian header and load commands) and `cs_blobs.h` (big-endian
/// signature blobs).
private enum MachOBuilder {

    static func unsigned() -> Data {
        var bytes = header(commandCount: 1, commandsSize: 24)
        bytes += le(0x32) + le(24) + [UInt8](repeating: 0, count: 16)   // LC_BUILD_VERSION
        return Data(bytes)
    }

    static func signed(entitlements: Data?) -> Data {
        let signatureOffset = 256

        // SuperBlob: a placeholder CodeDirectory, plus entitlements if given.
        var blobs: [(type: UInt32, bytes: [UInt8])] = [(0, be(0xFADE_0C02) + be(8))]
        if let entitlements {
            blobs.append((5, be(0xFADE_7171) + be(UInt32(8 + entitlements.count)) + [UInt8](entitlements)))
        }
        let indexSize = 12 + blobs.count * 8
        var index: [UInt8] = []
        var payload: [UInt8] = []
        for blob in blobs {
            index += be(blob.type) + be(UInt32(indexSize + payload.count))
            payload += blob.bytes
        }
        let superBlob = be(0xFADE_0CC0) + be(UInt32(indexSize + payload.count))
            + be(UInt32(blobs.count)) + index + payload

        var bytes = header(commandCount: 2, commandsSize: 24 + 16)
        bytes += le(0x32) + le(24) + [UInt8](repeating: 0, count: 16)   // LC_BUILD_VERSION
        bytes += le(0x1D) + le(16) + le(UInt32(signatureOffset)) + le(UInt32(superBlob.count))
        bytes += [UInt8](repeating: 0, count: signatureOffset - bytes.count)
        bytes += superBlob
        return Data(bytes)
    }

    private static func header(commandCount: UInt32, commandsSize: UInt32) -> [UInt8] {
        le(0xFEED_FACF) + le(0x0100_000C) + le(0) + le(2)
            + le(commandCount) + le(commandsSize) + le(0) + le(0)
    }

    private static func le(_ value: UInt32) -> [UInt8] {
        withUnsafeBytes(of: value.littleEndian, Array.init)
    }

    private static func be(_ value: UInt32) -> [UInt8] {
        withUnsafeBytes(of: value.bigEndian, Array.init)
    }
}
