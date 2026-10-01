import SwiftUI

/// The first screen: where the page comes from.
///
/// Usually never typed: the PC's connect page shows a QR code with
/// `vilniuscommute://connect?url=…`, and the iPhone camera opens it.
struct ShellSetupView: View {
    /// Returns false when what was typed is not an address.
    let onConnect: (String) -> Bool

    @State private var address: String
    @State private var invalid = false
    @FocusState private var focused: Bool

    init(initialAddress: String = "", onConnect: @escaping (String) -> Bool) {
        self.onConnect = onConnect
        _address = State(initialValue: initialAddress)
    }

    var body: some View {
        ShellPage {
            VStack(alignment: .leading, spacing: 12) {
                Text("Prijunk prie kompiuterio")
                    .font(.system(size: 28, weight: .bold))
                    .tracking(-0.28)
                Text("Programėlė rodoma iš tavo kompiuterio. Kompiuteryje paleisk „Paleisti-iPhone.bat“ ir nuskenuok QR kodą iPhone kamera arba įvesk adresą.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            VStack(alignment: .leading, spacing: 8) {
                TextField("192.168.1.23:8765", text: $address)
                    .font(.body.monospacedDigit())
                    .keyboardType(.URL)
                    .textContentType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.go)
                    .focused($focused)
                    .onSubmit(connect)
                    .padding(.horizontal, 16)
                    .frame(height: 50)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(Color(uiColor: .secondarySystemFill)))
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .strokeBorder(invalid ? Color.red : .clear, lineWidth: 1.5))
                    .onChange(of: address) { _, _ in invalid = false }
                if invalid {
                    Text("Tai ne adresas. Pavyzdžiui: 192.168.1.23:8765")
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
            }

            ShellPrimaryButton(title: "Prisijungti", action: connect)
                .disabled(address.trimmingCharacters(in: .whitespaces).isEmpty)
        }
    }

    private func connect() {
        if onConnect(address) {
            focused = false
        } else {
            invalid = true
        }
    }
}

/// The page did not load.
struct ShellFailureView: View {
    let onRetry: () -> Void
    let onChangeAddress: () -> Void

    var body: some View {
        ShellPage {
            VStack(alignment: .leading, spacing: 12) {
                Text("Kompiuteris nepasiekiamas")
                    .font(.system(size: 28, weight: .bold))
                    .tracking(-0.28)
                Text("Patikrink, ar kompiuteryje veikia „Paleisti-iPhone.bat“ ir ar telefonas tame pačiame Wi-Fi tinkle.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            VStack(spacing: 8) {
                ShellPrimaryButton(title: "Bandyti dar kartą", action: onRetry)
                ShellSecondaryButton(title: "Keisti adresą", action: onChangeAddress)
            }
        }
    }
}

/// While the page loads.
struct ShellLoadingView: View {
    var body: some View {
        ZStack {
            Color.pageBackground.ignoresSafeArea()
            ProgressView()
                .controlSize(.large)
        }
    }
}

// MARK: - Pieces

/// A plain page: content from the top, 16 pt margins, on the page colour.
private struct ShellPage<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                content
            }
            .padding(.horizontal, 16)
            .padding(.top, 72)
            .padding(.bottom, 24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollBounceBehavior(.basedOnSize)
        .background(Color.pageBackground.ignoresSafeArea())
    }
}

private struct ShellPrimaryButton: View {
    let title: String
    let action: () -> Void
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.headline)
                .foregroundStyle(Color(uiColor: .systemBackground))
                .frame(maxWidth: .infinity)
                .frame(height: 50)
                .background(Capsule().fill(Color.primary))
                .opacity(isEnabled ? 1 : 0.35)
        }
        .buttonStyle(.plain)
    }
}

private struct ShellSecondaryButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.headline)
                .foregroundStyle(.primary)
                .frame(maxWidth: .infinity)
                .frame(height: 50)
                .background(Capsule().fill(Color(uiColor: .secondarySystemFill)))
        }
        .buttonStyle(.plain)
    }
}

#Preview("Setup") {
    ShellSetupView { _ in true }
}

#Preview("Failure") {
    ShellFailureView(onRetry: {}, onChangeAddress: {})
}
