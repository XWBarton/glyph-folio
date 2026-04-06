import SwiftUI

/// Shared gradient background matching the glyph sibling apps' liquid-glass aesthetic.
var backgroundGradient: some View {
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
