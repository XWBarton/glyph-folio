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
    @Published var edges: [(String, String)] = []

    // d3-force style alpha cooling: starts at 1, decays toward 0 over ~450 ticks (~15 s)
    private var alpha: Double = 1.0
    private let alphaDecay: Double = 1 - pow(0.001, 1.0 / 450.0)  // ≈ 0.0153
    private let alphaMin:   Double = 0.001

    private var cancellable: AnyCancellable?
    private var draggedNodeId: String? = nil

    func reset(notes: [Note], lens: GraphLens, size: CGSize) {
        let n = notes.count
        guard n > 0 else { nodes = []; edges = []; return }

        // Phyllotaxis spiral — distributes nodes evenly without clustering at poles
        let goldenAngle = 2.399963  // 2π / φ²
        let spread = min(size.width, size.height) * 0.38

        func spiralPos(_ i: Int, _ total: Int) -> (Double, Double) {
            let t = Double(i) / Double(max(total - 1, 1))
            let angle = Double(i) * goldenAngle
            let r = spread * sqrt(t + 0.05)
            return (size.width / 2 + r * cos(angle), size.height / 2 + r * sin(angle))
        }

        var seen = Set<String>()
        var result: [(String, String)] = []

        switch lens {
        case .links:
            nodes = notes.enumerated().map { i, note in
                let (x, y) = spiralPos(i, n)
                return Node(id: note.id, title: note.title, type: .note, x: x, y: y)
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
            let allTags = Array(Set(notes.flatMap(\.tags))).sorted()
            let total = n + allTags.count
            let noteNodes: [Node] = notes.enumerated().map { i, note in
                let (x, y) = spiralPos(i, total)
                return Node(id: note.id, title: note.title, type: .note, x: x, y: y)
            }
            let tagNodes: [Node] = allTags.enumerated().map { i, tag in
                let (x, y) = spiralPos(n + i, total)
                return Node(id: "tag:\(tag)", title: tag, type: .tag, x: x, y: y)
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
        alpha = 1.0  // reheat for new layout
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
            nodes[i].vx = 0; nodes[i].vy = 0
        }
        alpha = 1.0  // reheat so the sim re-settles from the new positions
    }

    func startDrag(nodeId: String) {
        draggedNodeId = nodeId
        alpha = max(alpha, 0.3)  // reheat so graph can readjust around dragged node
        if let i = nodes.firstIndex(where: { $0.id == nodeId }) {
            nodes[i].vx = 0; nodes[i].vy = 0
        }
    }

    func moveDrag(nodeId: String, x: Double, y: Double) {
        guard draggedNodeId == nodeId,
              let i = nodes.firstIndex(where: { $0.id == nodeId }) else { return }
        nodes[i].x = x; nodes[i].y = y
        nodes[i].vx = 0; nodes[i].vy = 0
    }

    func endDrag() { draggedNodeId = nil }

    private func step(size: CGSize) {
        guard nodes.count > 1 else { return }
        // Skip physics when cooled — but still run if user is dragging (keep alpha alive)
        guard alpha > alphaMin || draggedNodeId != nil else { return }

        // d3-force style constants
        let charge:        Double = -3_500  // many-body repulsion per node pair
        let linkDist:      Double = 120     // desired edge length
        let linkStr:       Double = 0.6     // spring stiffness, split between endpoints
        let collideR:      Double = 50      // hard minimum separation
        let velocityDecay: Double = 0.4     // fraction of velocity lost per tick
        let cx = size.width / 2, cy = size.height / 2

        var fx = [Double](repeating: 0, count: nodes.count)
        var fy = [Double](repeating: 0, count: nodes.count)

        // Many-body repulsion — scaled by alpha
        for i in nodes.indices {
            for j in (i + 1) ..< nodes.count {
                let dx = nodes[i].x - nodes[j].x
                let dy = nodes[i].y - nodes[j].y
                let d2 = max(dx * dx + dy * dy, 1)
                let d  = sqrt(d2)
                let f  = alpha * charge / d2   // negative → repulsion
                fx[i] += f * dx / d;  fy[i] += f * dy / d
                fx[j] -= f * dx / d;  fy[j] -= f * dy / d
            }
        }

        // Link spring — pulls connected nodes toward linkDist
        for (aId, bId) in edges {
            guard let i = nodes.firstIndex(where: { $0.id == aId }),
                  let j = nodes.firstIndex(where: { $0.id == bId }) else { continue }
            let dx = nodes[j].x - nodes[i].x
            let dy = nodes[j].y - nodes[i].y
            let d  = max(sqrt(dx * dx + dy * dy), 0.001)
            let f  = alpha * linkStr * (d - linkDist) / d
            fx[i] += f * dx * 0.5;  fy[i] += f * dy * 0.5
            fx[j] -= f * dx * 0.5;  fy[j] -= f * dy * 0.5
        }

        // d3-style centre force: translate the whole graph's centre-of-mass to canvas centre.
        // This does NOT pull individual nodes — it just corrects global drift.
        let n = Double(nodes.count)
        let meanX = nodes.map(\.x).reduce(0, +) / n
        let meanY = nodes.map(\.y).reduce(0, +) / n
        let shiftX = (cx - meanX) * alpha * 0.1
        let shiftY = (cy - meanY) * alpha * 0.1
        for i in nodes.indices {
            fx[i] += shiftX
            fy[i] += shiftY
        }

        // Collision — NOT alpha-scaled; always prevent overlap
        for i in nodes.indices {
            for j in (i + 1) ..< nodes.count {
                let dx = nodes[i].x - nodes[j].x
                let dy = nodes[i].y - nodes[j].y
                let d  = sqrt(dx * dx + dy * dy)
                guard d < collideR, d > 0 else { continue }
                let push = (collideR - d) / d * 0.5
                fx[i] += dx * push;  fy[i] += dy * push
                fx[j] -= dx * push;  fy[j] -= dy * push
            }
        }

        // Integrate with velocity decay
        let pad = 30.0
        for i in nodes.indices {
            guard nodes[i].id != draggedNodeId else { continue }
            nodes[i].vx = (nodes[i].vx + fx[i]) * (1 - velocityDecay)
            nodes[i].vy = (nodes[i].vy + fy[i]) * (1 - velocityDecay)
            nodes[i].x  = min(max(nodes[i].x + nodes[i].vx, pad), size.width  - pad)
            nodes[i].y  = min(max(nodes[i].y + nodes[i].vy, pad), size.height - pad)
        }

        // Cool down alpha each tick
        alpha *= (1 - alphaDecay)
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
    // Selection state — first tap highlights, second tap opens
    @State private var selectedNodeId: String? = nil

    var body: some View {
        GeometryReader { geo in
            ZStack {
                Canvas { ctx, _ in
                    ctx.translateBy(x: offset.width, y: offset.height)
                    ctx.scaleBy(x: scale, y: scale)

                    // Pre-compute which node IDs are connected to the selection
                    let connectedIds: Set<String>? = selectedNodeId.map { sel in
                        var ids: Set<String> = [sel]
                        for (a, b) in sim.edges {
                            if a == sel { ids.insert(b) }
                            if b == sel { ids.insert(a) }
                        }
                        return ids
                    }

                    // Edges — highlighted when connected to selection, dimmed otherwise
                    for (aId, bId) in sim.edges {
                        guard let n1 = sim.nodes.first(where: { $0.id == aId }),
                              let n2 = sim.nodes.first(where: { $0.id == bId }) else { continue }
                        let isActive = connectedIds.map { $0.contains(aId) && $0.contains(bId) } ?? true
                        let tagNode = [n1, n2].first(where: { $0.type == .tag })
                        let baseColor: Color = {
                            guard let t = tagNode else { return .secondary }
                            if let hex = settings.tagColors[t.title] { return Color(hex: hex) }
                            return tagHashColor(t.title)
                        }()
                        var p = Path()
                        p.move(to: CGPoint(x: n1.x, y: n1.y))
                        p.addLine(to: CGPoint(x: n2.x, y: n2.y))
                        ctx.stroke(p, with: .color(baseColor.opacity(isActive ? 0.55 : 0.06)), lineWidth: isActive ? 1.5 : 1)
                    }

                    // Nodes — draw notes first, then tags on top
                    for pass in [false, true] {
                      for node in sim.nodes {
                        let isTag = node.type == .tag
                        guard isTag == pass else { continue }
                        let isActive = connectedIds.map { $0.contains(node.id) } ?? true
                        let isSelected = node.id == selectedNodeId
                        let dim: Double = isActive ? 1.0 : 0.15
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
                        let r: Double = isTag ? 6 : (isSelected ? 9 : 7)
                        if isTag {
                            var diamond = Path()
                            diamond.move(to:    CGPoint(x: node.x,     y: node.y - r))
                            diamond.addLine(to: CGPoint(x: node.x + r, y: node.y))
                            diamond.addLine(to: CGPoint(x: node.x,     y: node.y + r))
                            diamond.addLine(to: CGPoint(x: node.x - r, y: node.y))
                            diamond.closeSubpath()
                            ctx.fill(diamond, with: .color(nodeColor.opacity(0.22 * dim)))
                            ctx.stroke(diamond, with: .color(nodeColor.opacity(dim)), style: StrokeStyle(lineWidth: 2))
                        } else {
                            let circle = CGRect(x: node.x - r, y: node.y - r, width: r * 2, height: r * 2)
                            ctx.fill(Circle().path(in: circle), with: .color(nodeColor.opacity(0.18 * dim)))
                            ctx.stroke(Circle().path(in: circle), with: .color(nodeColor.opacity(dim)), lineWidth: isSelected ? 2.5 : 1.5)
                        }
                        guard isActive else { continue }  // skip labels for dimmed nodes
                        let truncated = node.title.count > 18
                            ? String(node.title.prefix(16)) + "…"
                            : node.title
                        let fontSize: CGFloat = isTag ? 11 : 10
                        let label = Text(truncated)
                            .font(.system(size: fontSize, weight: isTag ? .semibold : (isSelected ? .semibold : .medium)))
                            .foregroundStyle(isTag ? nodeColor : Color.primary)
                        let labelPt = CGPoint(x: node.x, y: node.y + (isTag ? r + 9 : r + 11))
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
                // Tap: first tap selects + highlights connections; second tap opens note
                .onTapGesture { screenPt in
                    guard let nearest = sim.nodes.min(by: { a, b in
                        screenDist(a, screenPt) < screenDist(b, screenPt)
                    }), screenDist(nearest, screenPt) < 36 else {
                        selectedNodeId = nil   // tap empty space → clear selection
                        return
                    }
                    if nearest.type == .note {
                        if selectedNodeId == nearest.id {
                            // Second tap on same node → open it
                            if let note = notes.first(where: { $0.id == nearest.id }) { onSelect(note) }
                            selectedNodeId = nil
                        } else {
                            selectedNodeId = nearest.id
                        }
                    } else {
                        // Tapping a tag node just highlights it
                        selectedNodeId = selectedNodeId == nearest.id ? nil : nearest.id
                    }
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
                        let s = fitScale()
                        scale = s; lastScale = s
                        let off = centreOffset(scale: s)
                        offset = off; lastOffset = off
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
                let s = fitScale(); scale = s; lastScale = s
                let off = centreOffset(scale: s); offset = off; lastOffset = off
            }
            .onDisappear { sim.stop() }
            .onChange(of: notes.map { $0.id }) { _, _ in
                sim.stop()
                sim.reset(notes: notes, lens: lens, size: size)
                sim.start(size: size)
                let s = fitScale(); scale = s; lastScale = s
                let off = centreOffset(scale: s); offset = off; lastOffset = off
            }
            .onChange(of: lens) { _, newLens in
                selectedNodeId = nil
                sim.stop()
                sim.reset(notes: notes, lens: newLens, size: size)
                sim.start(size: size)
                let s = fitScale(); scale = s; lastScale = s
                let off = centreOffset(scale: s); offset = off; lastOffset = off
            }
            .onReceive(NotificationCenter.default.publisher(for: .deviceDidShake)) { _ in
                sim.scatter(size: size)
            }
        }
    }

    // Compute zoom so the graph fills the view comfortably.
    // Formula: 3.5 / √nodeCount  (≈1× at ≤12 nodes, ≈0.7× at 25, ≈0.55× at 40)
    private func fitScale() -> CGFloat {
        let n = sim.nodes.count
        guard n > 1 else { return 1.0 }
        return min(1.0, max(0.35, 3.5 / sqrt(Double(n))))
    }

    // Offset that keeps physics centre at screen centre for a given scale.
    // Canvas transform: screen_pt = physics_pt * scale + offset
    // → offset = screen_centre - physics_centre * scale = size/2 * (1 - scale)
    private func centreOffset(scale s: CGFloat) -> CGSize {
        CGSize(width: size.width / 2 * (1 - s), height: size.height / 2 * (1 - s))
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
