import SwiftUI
import UIKit

/// Shared gradient background — adapts to light/dark mode.
struct BackgroundGradient: View {
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        if colorScheme == .dark {
            ZStack {
                Color(red: 0.07, green: 0.08, blue: 0.12).ignoresSafeArea()
                RadialGradient(
                    colors: [Color(red: 0.14, green: 0.20, blue: 0.38).opacity(0.85), .clear],
                    center: UnitPoint(x: 0.2, y: 0.1), startRadius: 0, endRadius: 500
                ).ignoresSafeArea()
                RadialGradient(
                    colors: [Color(red: 0.20, green: 0.14, blue: 0.32).opacity(0.75), .clear],
                    center: UnitPoint(x: 0.8, y: 0.2), startRadius: 0, endRadius: 450
                ).ignoresSafeArea()
                RadialGradient(
                    colors: [Color(red: 0.10, green: 0.24, blue: 0.20).opacity(0.65), .clear],
                    center: UnitPoint(x: 0.6, y: 0.8), startRadius: 0, endRadius: 400
                ).ignoresSafeArea()
                RadialGradient(
                    colors: [Color(red: 0.24, green: 0.18, blue: 0.10).opacity(0.55), .clear],
                    center: UnitPoint(x: 0.1, y: 0.8), startRadius: 0, endRadius: 350
                ).ignoresSafeArea()
            }
        } else {
            ZStack {
                Color(red: 0.94, green: 0.96, blue: 1.0).ignoresSafeArea()
                RadialGradient(
                    colors: [Color(red: 0.86, green: 0.92, blue: 1.0).opacity(0.95), .clear],
                    center: UnitPoint(x: 0.2, y: 0.1), startRadius: 0, endRadius: 500
                ).ignoresSafeArea()
                RadialGradient(
                    colors: [Color(red: 0.93, green: 0.91, blue: 1.0).opacity(0.85), .clear],
                    center: UnitPoint(x: 0.8, y: 0.2), startRadius: 0, endRadius: 450
                ).ignoresSafeArea()
                RadialGradient(
                    colors: [Color(red: 0.86, green: 0.99, blue: 0.90).opacity(0.75), .clear],
                    center: UnitPoint(x: 0.6, y: 0.8), startRadius: 0, endRadius: 400
                ).ignoresSafeArea()
                RadialGradient(
                    colors: [Color(red: 1.0, green: 0.95, blue: 0.78).opacity(0.65), .clear],
                    center: UnitPoint(x: 0.1, y: 0.8), startRadius: 0, endRadius: 350
                ).ignoresSafeArea()
            }
        }
    }
}

/// Convenience property for call sites that already used `backgroundGradient`.
var backgroundGradient: BackgroundGradient { BackgroundGradient() }

/// Accent color matching --accent: #2563eb
extension Color {
    static let glyphAccent = Color(red: 0.145, green: 0.388, blue: 0.922)

    init(hex: String) {
        var v: UInt64 = 0
        Scanner(string: hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)).scanHexInt64(&v)
        self.init(red: Double((v >> 16) & 0xFF) / 255,
                  green: Double((v >>  8) & 0xFF) / 255,
                  blue:  Double( v        & 0xFF) / 255)
    }
}

/// Shared 12-color palette — same as desktop TAG_PALETTE
let tagColorPalette: [String] = [
    "#2563eb", "#059669", "#7c3aed", "#ea580c", "#db2777", "#0891b2",
    "#65a30d", "#dc2626", "#d97706", "#4f46e5", "#0f766e", "#9333ea",
]

/// Deterministic color from tag name — fallback when no user color is set
func tagHashColor(_ tag: String) -> Color {
    var h: UInt32 = 0
    for c in tag.unicodeScalars { h = (h &* 31) &+ c.value }
    return Color(hex: tagColorPalette[Int(h % UInt32(tagColorPalette.count))])
}

// ── Typst title rendering ─────────────────────────────────────────────────────

func styledTitle(_ raw: String, size: CGFloat = 15, weight: Font.Weight = .medium) -> AttributedString {
    let base     = Font.system(size: size, weight: weight)
    let bold     = Font.system(size: size, weight: .bold)
    let ital     = Font.system(size: size, weight: weight).italic()
    let boldItal = Font.system(size: size, weight: .bold).italic()

    guard let regex = try? NSRegularExpression(
        pattern: #"\*_([^_*\n]+)_\*|_\*([^*_\n]+)\*_|\*([^*\n]+)\*|_([^_\n]+)_"#
    ) else {
        var a = AttributedString(raw); a.font = base; return a
    }

    var result = AttributedString()
    let ns = raw as NSString
    var cursor = 0

    for m in regex.matches(in: raw, range: NSRange(location: 0, length: ns.length)) {
        if m.range.location > cursor {
            var seg = AttributedString(ns.substring(with: NSRange(location: cursor, length: m.range.location - cursor)))
            seg.font = base; result += seg
        }
        var matchedText = ""
        var font = base
        for g in 1...4 {
            let r = m.range(at: g)
            guard r.location != NSNotFound else { continue }
            matchedText = ns.substring(with: r)
            font = g == 1 || g == 2 ? boldItal : g == 3 ? bold : ital
            break
        }
        var seg = AttributedString(matchedText); seg.font = font; result += seg
        cursor = m.range.location + m.range.length
    }

    if cursor < ns.length {
        var seg = AttributedString(ns.substring(with: NSRange(location: cursor, length: ns.length - cursor)))
        seg.font = base; result += seg
    }
    return result
}

// ── Shake detection ───────────────────────────────────────────────────────────

extension NSNotification.Name {
    static let deviceDidShake = NSNotification.Name("GlyphFolioDeviceDidShake")
}

extension UIWindow {
    open override func motionEnded(_ motion: UIEvent.EventSubtype, with event: UIEvent?) {
        if motion == .motionShake {
            NotificationCenter.default.post(name: .deviceDidShake, object: nil)
        }
        super.motionEnded(motion, with: event)
    }
}
