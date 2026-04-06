import SwiftUI
import Combine

// ── Lens ─────────────────────────────────────────────────────────────────────

enum GraphLens { case links, tags }

// ── Simulation ────────────────────────────────────────────────────────────────

@MainActor
final class GraphSimulation: ObservableObject {
    struct Node {
        let id: String
        let title: String
        var x: Double
        var y: Double
        var vx: Double = 0
        var vy: Double = 0
    }

    @Published var nodes: [Node] = []
    @Published var edges: [(String, String)] = []   // pairs of note IDs

    private var cancellable: AnyCancellable?

    func reset(notes: [Note], lens: GraphLens, size: CGSize) {
        let n = notes.count
        guard n > 0 else { nodes = []; edges = []; return }

        // Place nodes in a circle initially
        let r = min(size.width, size.height) * 0.33
        let cx = size.width / 2, cy = size.height / 2
        nodes = notes.enumerated().map { i, note in
            let angle = 2 * .pi * Double(i) / Double(n)
            return Node(id: note.id, title: note.title,
                        x: cx + r * cos(angle), y: cy + r * sin(angle))
        }

        var seen = Set<String>()
        var result: [(String, String)] = []

        switch lens {
        case .links:
            for note in notes {
                for link in note.links {
                    let linkLower = link.lowercased()
                    guard let target = notes.first(where: { n in
                        n.title.lowercased() == linkLower || n.id == link
                    }) else { continue }
                    let key = ([note.id, target.id].sorted()).joined(separator: "|")
                    if seen.insert(key).inserted { result.append((note.id, target.id)) }
                }
            }
        case .tags:
            for i in notes.indices {
                for j in (i + 1) ..< notes.count {
                    let shared = Set(notes[i].tags).intersection(notes[j].tags)
                    guard !shared.isEmpty else { continue }
                    let key = ([notes[i].id, notes[j].id].sorted()).joined(separator: "|")
                    if seen.insert(key).inserted { result.append((notes[i].id, notes[j].id)) }
                }
            }
        }

        edges = result
    }

    func start(size: CGSize) {
        cancellable = Timer.publish(every: 1.0 / 30.0, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] _ in self?.step(size: size) }
    }

    func stop() { cancellable = nil }

    private func step(size: CGSize) {
        guard nodes.count > 1 else { return }

        let repulsion = 4_000.0
        let springK    = 0.06
        let springLen  = 160.0
        let gravity    = 0.04
        let damping    = 0.85
        let cx = size.width / 2, cy = size.height / 2

        var fx = [Double](repeating: 0, count: nodes.count)
        var fy = [Double](repeating: 0, count: nodes.count)

        // Repulsion (all pairs)
        for i in nodes.indices {
            for j in (i + 1) ..< nodes.count {
                let dx = nodes[i].x - nodes[j].x
                let dy = nodes[i].y - nodes[j].y
                let d2 = max(dx * dx + dy * dy, 1)
                let d  = sqrt(d2)
                let f  = repulsion / d2
                fx[i] += f * dx / d;  fy[i] += f * dy / d
                fx[j] -= f * dx / d;  fy[j] -= f * dy / d
            }
        }

        // Spring attraction along edges
        for (aId, bId) in edges {
            guard let i = nodes.firstIndex(where: { $0.id == aId }),
                  let j = nodes.firstIndex(where: { $0.id == bId }) else { continue }
            let dx = nodes[j].x - nodes[i].x
            let dy = nodes[j].y - nodes[i].y
            let d  = max(sqrt(dx * dx + dy * dy), 0.001)
            let stretch = d - springLen
            let f = springK * stretch
            fx[i] += f * dx / d;  fy[i] += f * dy / d
            fx[j] -= f * dx / d;  fy[j] -= f * dy / d
        }

        // Gravity toward canvas center
        for i in nodes.indices {
            fx[i] += gravity * (cx - nodes[i].x)
            fy[i] += gravity * (cy - nodes[i].y)
        }

        // Integrate
        let pad = 50.0
        for i in nodes.indices {
            nodes[i].vx = (nodes[i].vx + fx[i]) * damping
            nodes[i].vy = (nodes[i].vy + fy[i]) * damping
            nodes[i].x  = min(max(nodes[i].x + nodes[i].vx, pad), size.width  - pad)
            nodes[i].y  = min(max(nodes[i].y + nodes[i].vy, pad), size.height - pad)
        }
    }
}

// ── Canvas view ───────────────────────────────────────────────────────────────

struct GraphView: View {
    let notes: [Note]
    var lens: GraphLens = .links
    let onSelect: (Note) -> Void

    @ObservedObject private var settings = AppSettings.shared
    @StateObject private var sim = GraphSimulation()
    @State private var size: CGSize = .zero

    // Pan + zoom state
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero
    @State private var scale: CGFloat = 1.0
    @State private var lastScale: CGFloat = 1.0

    var body: some View {
        GeometryReader { geo in
            ZStack {
                Canvas { ctx, _ in
                    ctx.translateBy(x: offset.width, y: offset.height)
                    ctx.scaleBy(x: scale, y: scale)

                    // Edges
                    for (aId, bId) in sim.edges {
                        guard let n1 = sim.nodes.first(where: { $0.id == aId }),
                              let n2 = sim.nodes.first(where: { $0.id == bId }) else { continue }
                        var p = Path()
                        p.move(to: CGPoint(x: n1.x, y: n1.y))
                        p.addLine(to: CGPoint(x: n2.x, y: n2.y))
                        ctx.stroke(p, with: .color(.secondary.opacity(0.35)), lineWidth: 1.5)
                    }

                    // Nodes
                    for node in sim.nodes {
                        let noteForNode = notes.first(where: { $0.id == node.id })
                        let nodeColor: Color = {
                            guard let tag = noteForNode?.tags.first else { return .glyphAccent }
                            if let hex = settings.tagColors[tag] { return Color(hex: hex) }
                            return tagHashColor(tag)
                        }()
                        let circle = CGRect(x: node.x - 7, y: node.y - 7, width: 14, height: 14)
                        ctx.fill(Circle().path(in: circle), with: .color(nodeColor.opacity(0.18)))
                        ctx.stroke(Circle().path(in: circle), with: .color(nodeColor), lineWidth: 1.5)
                        let truncated = node.title.count > 18
                            ? String(node.title.prefix(16)) + "…"
                            : node.title
                        let label = Text(truncated)
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(.primary)
                        let labelPt = CGPoint(x: node.x, y: node.y + 18)
                        // Background pill so label doesn't bleed into nearby nodes/edges
                        let textSize = CGSize(width: CGFloat(truncated.count) * 5.5 + 8, height: 14)
                        let bgRect = CGRect(
                            x: labelPt.x - textSize.width / 2,
                            y: labelPt.y - 7,
                            width: textSize.width,
                            height: textSize.height
                        )
                        ctx.fill(
                            RoundedRectangle(cornerRadius: 3).path(in: bgRect),
                            with: .color(.white.opacity(0.75))
                        )
                        ctx.draw(label, at: labelPt)
                    }
                }
                // Tap: hit-test in screen space accounting for transform
                .onTapGesture { screenPt in
                    guard let nearest = sim.nodes.min(by: { a, b in
                        screenDist(a, screenPt) < screenDist(b, screenPt)
                    }), screenDist(nearest, screenPt) < 28 else { return }
                    if let note = notes.first(where: { $0.id == nearest.id }) { onSelect(note) }
                }
                // Pan
                .gesture(
                    DragGesture(minimumDistance: 4)
                        .onChanged { v in
                            offset = CGSize(
                                width:  lastOffset.width  + v.translation.width,
                                height: lastOffset.height + v.translation.height
                            )
                        }
                        .onEnded { _ in lastOffset = offset }
                )
                // Zoom — anchored to canvas center so it feels natural
                .gesture(
                    MagnificationGesture()
                        .onChanged { v in
                            let newScale = (lastScale * v).clamped(to: 0.15...8)
                            let cx = size.width / 2
                            let cy = size.height / 2
                            let factor = newScale / scale
                            offset = CGSize(
                                width:  cx - (cx - offset.width)  * factor,
                                height: cy - (cy - offset.height) * factor
                            )
                            scale = newScale
                        }
                        .onEnded { _ in lastOffset = offset; lastScale = scale }
                )
                // Double-tap to reset
                .onTapGesture(count: 2) {
                    withAnimation(.spring()) {
                        offset = .zero; lastOffset = .zero
                        scale = 1; lastScale = 1
                    }
                }

                // Hint badge
                VStack {
                    Spacer()
                    HStack(spacing: 6) {
                        if sim.edges.isEmpty && !notes.isEmpty {
                            Text("Link notes with [[Note Title]] — double-tap to reset")
                        } else {
                            Text("Pinch to zoom · drag to pan · double-tap to reset")
                        }
                    }
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .padding(.bottom, 10)
                }
            }
            .onAppear {
                size = geo.size
                sim.reset(notes: notes, lens: lens, size: size)
                sim.start(size: size)
            }
            .onDisappear { sim.stop() }
            .onChange(of: notes.map { $0.id }) { _, _ in
                sim.stop()
                sim.reset(notes: notes, lens: lens, size: size)
                sim.start(size: size)
            }
            .onChange(of: lens) { _, newLens in
                sim.stop()
                sim.reset(notes: notes, lens: newLens, size: size)
                sim.start(size: size)
            }
        }
    }

    // Screen-space distance from node to tap point
    private func screenDist(_ node: GraphSimulation.Node, _ pt: CGPoint) -> CGFloat {
        hypot(node.x * scale + offset.width  - pt.x,
              node.y * scale + offset.height - pt.y)
    }
}

extension Comparable {
    func clamped(to range: ClosedRange<Self>) -> Self {
        min(max(self, range.lowerBound), range.upperBound)
    }
}
