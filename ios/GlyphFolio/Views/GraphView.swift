import SwiftUI
import Combine

// ── Lens ─────────────────────────────────────────────────────────────────────

enum GraphLens { case links, tags }

// ── Simulation ────────────────────────────────────────────────────────────────

@MainActor
final class GraphSimulation: ObservableObject {
    enum NodeType { case note, tag }

    struct Node {
        let id: String
        let title: String
        var type: NodeType = .note
        var x: Double
        var y: Double
        var vx: Double = 0
        var vy: Double = 0
    }

    @Published var nodes: [Node] = []
    @Published var edges: [(String, String)] = []   // pairs of note IDs

    private var cancellable: AnyCancellable?
    private var draggedNodeId: String? = nil

    func reset(notes: [Note], lens: GraphLens, size: CGSize) {
        let n = notes.count
        guard n > 0 else { nodes = []; edges = []; return }

        let r = min(size.width, size.height) * 0.33
        let cx = size.width / 2, cy = size.height / 2

        var seen = Set<String>()
        var result: [(String, String)] = []

        switch lens {
        case .links:
            nodes = notes.enumerated().map { i, note in
                let angle = 2 * .pi * Double(i) / Double(n)
                return Node(id: note.id, title: note.title, type: .note,
                            x: cx + r * cos(angle), y: cy + r * sin(angle))
            }
            for note in notes {
                for link in note.links {
                    let linkLower = link.lowercased()
                    guard let target = notes.first(where: { t in
                        t.title.lowercased() == linkLower || t.id == link
                    }) else { continue }
                    let key = ([note.id, target.id].sorted()).joined(separator: "|")
                    if seen.insert(key).inserted { result.append((note.id, target.id)) }
                }
            }

        case .tags:
            // All nodes (notes + tags) spread uniformly on the same ring
            let allTags = Array(Set(notes.flatMap(\.tags))).sorted()
            let total = n + allTags.count
            let noteNodes: [Node] = notes.enumerated().map { i, note in
                let angle = 2 * .pi * Double(i) / Double(max(1, total))
                return Node(id: note.id, title: note.title, type: .note,
                            x: cx + r * cos(angle), y: cy + r * sin(angle))
            }
            let tagNodes: [Node] = allTags.enumerated().map { i, tag in
                let angle = 2 * .pi * Double(n + i) / Double(max(1, total))
                return Node(id: "tag:\(tag)", title: tag, type: .tag,
                            x: cx + r * cos(angle), y: cy + r * sin(angle))
            }
            nodes = noteNodes + tagNodes

            for note in notes {
                for tag in note.tags {
                    let key = "\(note.id)|tag:\(tag)"
                    if seen.insert(key).inserted { result.append((note.id, "tag:\(tag)")) }
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

    func scatter(size: CGSize) {
        let pad = 60.0
        for i in nodes.indices {
            nodes[i].x  = Double.random(in: pad...(size.width  - pad))
            nodes[i].y  = Double.random(in: pad...(size.height - pad))
            nodes[i].vx = Double.random(in: -4...4)
            nodes[i].vy = Double.random(in: -4...4)
        }
    }

    func startDrag(nodeId: String) {
        draggedNodeId = nodeId
        if let i = nodes.firstIndex(where: { $0.id == nodeId }) {
            nodes[i].vx = 0
            nodes[i].vy = 0
        }
    }

    func moveDrag(nodeId: String, x: Double, y: Double) {
        guard draggedNodeId == nodeId,
              let i = nodes.firstIndex(where: { $0.id == nodeId }) else { return }
        nodes[i].x = x
        nodes[i].y = y
        nodes[i].vx = 0
        nodes[i].vy = 0
    }

    func endDrag() {
        draggedNodeId = nil
    }

    private func step(size: CGSize) {
        guard nodes.count > 1 else { return }

        let repulsion = 10_000.0
        let springK   = 0.05
        let springLen = 150.0
        let gravity   = 0.06
        let damping   = 0.88
        let minSep    = 38.0
        let cx = size.width / 2, cy = size.height / 2

        var fx = [Double](repeating: 0, count: nodes.count)
        var fy = [Double](repeating: 0, count: nodes.count)

        // Repulsion (all pairs) + collision separation
        for i in nodes.indices {
            for j in (i + 1) ..< nodes.count {
                let dx = nodes[i].x - nodes[j].x
                let dy = nodes[i].y - nodes[j].y
                let d2 = max(dx * dx + dy * dy, 1)
                let d  = sqrt(d2)
                let f  = repulsion / d2
                fx[i] += f * dx / d;  fy[i] += f * dy / d
                fx[j] -= f * dx / d;  fy[j] -= f * dy / d

                // Extra push when nodes are too close
                if d < minSep {
                    let overlap = (minSep - d) * 0.5
                    let nx = dx / d
                    let ny = dy / d
                    fx[i] += nx * overlap * 1.5;  fy[i] += ny * overlap * 1.5
                    fx[j] -= nx * overlap * 1.5;  fy[j] -= ny * overlap * 1.5
                }
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

        // Uniform gentle gravity toward center — keeps nodes from drifting off screen
        for i in nodes.indices {
            fx[i] += gravity * (cx - nodes[i].x)
            fy[i] += gravity * (cy - nodes[i].y)
        }

        // Integrate
        let pad = 50.0
        for i in nodes.indices {
            guard nodes[i].id != draggedNodeId else { continue }
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

    @Environment(\.colorScheme) private var colorScheme
    @ObservedObject private var settings = AppSettings.shared
    @StateObject private var sim = GraphSimulation()
    @State private var size: CGSize = .zero

    // Pan + zoom state
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero
    @State private var scale: CGFloat = 1.0
    @State private var lastScale: CGFloat = 1.0
    @State private var draggingNodeId: String? = nil

    var body: some View {
        GeometryReader { geo in
            ZStack {
                Canvas { ctx, _ in
                    ctx.translateBy(x: offset.width, y: offset.height)
                    ctx.scaleBy(x: scale, y: scale)

                    // Edges — color-matched to tag, curved so parallel edges don't stack
                    for (aId, bId) in sim.edges {
                        guard let n1 = sim.nodes.first(where: { $0.id == aId }),
                              let n2 = sim.nodes.first(where: { $0.id == bId }) else { continue }
                        let tagNode = [n1, n2].first(where: { $0.type == .tag })
                        let edgeColor: Color = {
                            guard let t = tagNode else { return .secondary.opacity(0.25) }
                            if let hex = settings.tagColors[t.title] { return Color(hex: hex).opacity(0.35) }
                            return tagHashColor(t.title).opacity(0.35)
                        }()
                        var p = Path()
                        p.move(to: CGPoint(x: n1.x, y: n1.y))
                        p.addLine(to: CGPoint(x: n2.x, y: n2.y))
                        ctx.stroke(p, with: .color(edgeColor), lineWidth: 1)
                    }

                    // Nodes — draw notes first, then tags on top so tags are always visible
                    for pass in [false, true] {
                      for node in sim.nodes {
                        let isTag = node.type == .tag
                        guard isTag == pass else { continue }
                        let noteForNode = isTag ? nil : notes.first(where: { $0.id == node.id })
                        let nodeColor: Color = {
                            if isTag {
                                if let hex = settings.tagColors[node.title] { return Color(hex: hex) }
                                return tagHashColor(node.title)
                            }
                            guard let tag = noteForNode?.tags.first else { return .glyphAccent }
                            if let hex = settings.tagColors[tag] { return Color(hex: hex) }
                            return tagHashColor(tag)
                        }()
                        let r: Double = isTag ? 6 : 7
                        if isTag {
                            var diamond = Path()
                            diamond.move(to:    CGPoint(x: node.x,     y: node.y - r))
                            diamond.addLine(to: CGPoint(x: node.x + r, y: node.y))
                            diamond.addLine(to: CGPoint(x: node.x,     y: node.y + r))
                            diamond.addLine(to: CGPoint(x: node.x - r, y: node.y))
                            diamond.closeSubpath()
                            ctx.fill(diamond, with: .color(nodeColor.opacity(0.22)))
                            ctx.stroke(diamond, with: .color(nodeColor), style: StrokeStyle(lineWidth: 2))
                        } else {
                            let circle = CGRect(x: node.x - r, y: node.y - r, width: r * 2, height: r * 2)
                            ctx.fill(Circle().path(in: circle), with: .color(nodeColor.opacity(0.18)))
                            ctx.stroke(Circle().path(in: circle), with: .color(nodeColor), lineWidth: 1.5)
                        }
                        let truncated = node.title.count > 18
                            ? String(node.title.prefix(16)) + "…"
                            : node.title
                        // Tag labels: colored, bold, larger — clearly a category header
                        let fontSize: CGFloat = isTag ? 11 : 10
                        let label = Text(truncated)
                            .font(.system(size: fontSize, weight: isTag ? .semibold : .medium))
                            .foregroundStyle(isTag ? nodeColor : Color.primary)
                        let labelPt = CGPoint(x: node.x, y: node.y + (isTag ? r + 9 : 18))
                        let textSize = CGSize(width: CGFloat(truncated.count) * (isTag ? 6.5 : 5.5) + 8, height: 14)
                        let bgRect = CGRect(
                            x: labelPt.x - textSize.width / 2,
                            y: labelPt.y - 7,
                            width: textSize.width,
                            height: textSize.height
                        )
                        ctx.fill(
                            RoundedRectangle(cornerRadius: 3).path(in: bgRect),
                            with: .color(colorScheme == .dark
                                ? Color.black.opacity(0.70)
                                : Color.white.opacity(0.82))
                        )
                        ctx.draw(label, at: labelPt)
                      }
                    }
                }
                // Tap: hit-test in screen space accounting for transform
                .onTapGesture { screenPt in
                    guard let nearest = sim.nodes.min(by: { a, b in
                        screenDist(a, screenPt) < screenDist(b, screenPt)
                    }), screenDist(nearest, screenPt) < 28,
                    nearest.type == .note else { return }
                    if let note = notes.first(where: { $0.id == nearest.id }) { onSelect(note) }
                }
                // Pan or node drag
                .gesture(
                    DragGesture(minimumDistance: 4)
                        .onChanged { v in
                            if draggingNodeId == nil {
                                // Decide mode on first movement
                                if let nearest = sim.nodes.min(by: { a, b in
                                    screenDist(a, v.startLocation) < screenDist(b, v.startLocation)
                                }), screenDist(nearest, v.startLocation) < 28 {
                                    draggingNodeId = nearest.id
                                    sim.startDrag(nodeId: nearest.id)
                                }
                            }
                            if let nodeId = draggingNodeId {
                                let simX = (v.location.x - offset.width) / scale
                                let simY = (v.location.y - offset.height) / scale
                                sim.moveDrag(nodeId: nodeId, x: Double(simX), y: Double(simY))
                            } else {
                                offset = CGSize(
                                    width:  lastOffset.width  + v.translation.width,
                                    height: lastOffset.height + v.translation.height
                                )
                            }
                        }
                        .onEnded { _ in
                            if draggingNodeId != nil {
                                sim.endDrag()
                                draggingNodeId = nil
                            } else {
                                lastOffset = offset
                            }
                        }
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
            .onReceive(NotificationCenter.default.publisher(for: .deviceDidShake)) { _ in
                sim.scatter(size: size)
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
