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
}
