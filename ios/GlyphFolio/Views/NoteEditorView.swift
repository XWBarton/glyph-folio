import SwiftUI
import UIKit

// ── Syntax highlighting ───────────────────────────────────────────────────────

private struct TokenRule {
    let pattern: NSRegularExpression
    let color: UIColor?
    let bold: Bool
    let italic: Bool
}

private let baseFont     = UIFont(name: "Menlo-Regular",     size: 16) ?? UIFont.monospacedSystemFont(ofSize: 16, weight: .regular)
private let boldFont     = UIFont(name: "Menlo-Bold",        size: 16) ?? UIFont.monospacedSystemFont(ofSize: 16, weight: .bold)
private let italicFont   = UIFont(name: "Menlo-Italic",      size: 16) ?? UIFont.monospacedSystemFont(ofSize: 16, weight: .regular)
private let boldItalFont = UIFont(name: "Menlo-BoldItalic",  size: 16) ?? UIFont.monospacedSystemFont(ofSize: 16, weight: .bold)

private func makeRule(_ pattern: String, _ hex: String? = nil,
                      bold: Bool = false, italic: Bool = false,
                      options: NSRegularExpression.Options = [.anchorsMatchLines]) -> TokenRule {
    let regex = try! NSRegularExpression(pattern: pattern, options: options)
    return TokenRule(pattern: regex, color: hex.map { UIColor(hex: $0) }, bold: bold, italic: italic)
}

private let tokenRules: [TokenRule] = [
    makeRule(#"//[^\n]*"#,              "9ca3af", italic: true),            // comment
    makeRule(#"^---$"#,                 "d1d5db"),                          // hr
    makeRule(#"\$[^\$\n]+\$"#,         "c2410c"),                          // inline math
    makeRule(#"```[\s\S]*?```"#,        "0f766e", options: []),             // code block
    makeRule(#"`[^`\n]+`"#,            "0f766e"),                          // inline code
    makeRule(#"\"[^\"\n]*\""#,         "059669"),                          // string
    makeRule(#"^[-+]\s"#,              "2563eb", bold: true),              // list marker
    makeRule(#"^={1,6}\s.+$"#,         "1d4ed8", bold: true),             // heading
    makeRule(#"_[^_\n]+_"#,            "374151", italic: true),            // italic
    makeRule(#"\*[^\*\n]+\*"#,         "111827", bold: true),              // bold
    makeRule(#"#(set|let|show|if|else|for|while|import|include|return)\b"#,
             "7c3aed", bold: true),                                         // keyword
    makeRule(#"#[a-zA-Z_][a-zA-Z0-9_]*"#, "0369a1"),                      // function
    makeRule(#"@[a-zA-Z_][a-zA-Z0-9_:.-]*"#, "be185d"),                   // reference
]

private func buildHighlightedText(_ text: String) -> NSAttributedString {
    let ns   = text as NSString
    let full = NSRange(location: 0, length: ns.length)

    let result = NSMutableAttributedString(string: text)
    result.addAttributes([
        .font:            baseFont,
        .foregroundColor: UIColor(hex: "1a1d2e"),
    ], range: full)

    for rule in tokenRules {
        for match in rule.pattern.matches(in: text, range: full) {
            let r = match.range
            if let color = rule.color { result.addAttribute(.foregroundColor, value: color, range: r) }
            let f: UIFont
            switch (rule.bold, rule.italic) {
            case (true,  true):  f = boldItalFont
            case (true,  false): f = boldFont
            case (false, true):  f = italicFont
            case (false, false): continue
            }
            result.addAttribute(.font, value: f, range: r)
        }
    }
    return result
}

// ── UIColor hex init ──────────────────────────────────────────────────────────

extension UIColor {
    convenience init(hex: String) {
        var int = UInt64()
        Scanner(string: hex.trimmingCharacters(in: .alphanumerics.inverted)).scanHexInt64(&int)
        self.init(red:   CGFloat((int >> 16) & 0xFF) / 255,
                  green: CGFloat((int >>  8) & 0xFF) / 255,
                  blue:  CGFloat( int        & 0xFF) / 255,
                  alpha: 1)
    }
}

// ── Editor controller ─────────────────────────────────────────────────────────

class EditorController: ObservableObject {
    fileprivate weak var textView: UITextView?

    func insert(_ text: String, wrapPrefix: String? = nil, wrapSuffix: String? = nil, replacingSlash: Bool = false) {
        guard let tv = textView, let sel = tv.selectedTextRange else { return }

        if let prefix = wrapPrefix, let suffix = wrapSuffix,
           let selected = tv.text(in: sel), !selected.isEmpty {
            tv.replace(sel, withText: prefix + selected + suffix)
            return
        }

        var range = sel
        if replacingSlash,
           let prev = tv.position(from: sel.start, offset: -1),
           let prevRange = tv.textRange(from: prev, to: sel.start),
           tv.text(in: prevRange) == "/" {
            range = prevRange
        }
        tv.replace(range, withText: text)
    }

    /// Replaces the [[ typed before the cursor with [[title]].
    func insertWikiLink(title: String) {
        guard let tv = textView else { return }
        let cursorLoc = tv.selectedRange.location
        let ns = tv.text as NSString
        let searchRange = NSRange(location: 0, length: cursorLoc)
        let bracketRange = ns.range(of: "[[", options: .backwards, range: searchRange)
        guard bracketRange.location != NSNotFound else { return }
        guard let start = tv.position(from: tv.beginningOfDocument, offset: bracketRange.location),
              let end   = tv.position(from: tv.beginningOfDocument, offset: cursorLoc),
              let range = tv.textRange(from: start, to: end) else { return }
        tv.replace(range, withText: "[[\(title)]]")
    }

    /// Inserts "- [ ] " at the cursor and, if not already present, injects the
    /// cheq import block immediately after the // @tags: line.
    func insertChecklistItem(replacingSlash: Bool = false) {
        guard let tv = textView else { return }

        // Remove the triggering / if called from slash palette
        if replacingSlash,
           let sel = tv.selectedTextRange,
           let prev = tv.position(from: sel.start, offset: -1),
           let prevRange = tv.textRange(from: prev, to: sel.start),
           tv.text(in: prevRange) == "/" {
            tv.replace(prevRange, withText: "")
        }

        var cursorLoc = tv.selectedRange.location
        let ns = NSMutableString(string: tv.text ?? "")

        // Inject the cheq import block if this note doesn't have it yet
        if !tv.text.contains("@preview/cheq") {
            let importBlock = "#import \"@preview/cheq:0.3.0\": checklist\n#show: checklist\n"

            // Find the end of the // @tags: line so the import sits right below it
            var insertLoc = 0
            let tagsRange = ns.range(of: "// @tags:", options: [])
            if tagsRange.location != NSNotFound {
                let searchFrom = NSRange(location: tagsRange.location, length: ns.length - tagsRange.location)
                let nlRange = ns.range(of: "\n", options: [], range: searchFrom)
                insertLoc = nlRange.location != NSNotFound ? nlRange.location + 1 : ns.length
            }

            ns.insert(importBlock, at: insertLoc)
            if cursorLoc >= insertLoc { cursorLoc += (importBlock as NSString).length }
        }

        // cheq requires text after [ ] — insert placeholder and select it
        // so the user immediately types over it
        let prefix = "- [ ] "
        let placeholder = "item"
        let safeInsert = min(cursorLoc, ns.length)
        ns.insert(prefix + placeholder, at: safeInsert)

        tv.text = ns as String
        // Select the placeholder text so the user can type straight over it
        let selectStart = safeInsert + (prefix as NSString).length
        let selectLen   = (placeholder as NSString).length
        tv.selectedRange = NSRange(location: min(selectStart, ns.length), length: min(selectLen, ns.length - selectStart))
        tv.delegate?.textViewDidChange?(tv)
    }
}

// ── UITextView wrapper ────────────────────────────────────────────────────────

struct TypstEditor: UIViewRepresentable {
    @Binding var text: String
    let controller: EditorController
    var onSlashTyped: () -> Void = {}
    var onWikiLinkTyped: () -> Void = {}
    var onShowPalette: () -> Void = {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> UITextView {
        let tv = UITextView()
        tv.delegate = context.coordinator
        tv.backgroundColor = .clear
        tv.isScrollEnabled = true
        tv.textContainerInset = UIEdgeInsets(top: 16, left: 16, bottom: 24, right: 16)
        tv.textContainer.lineFragmentPadding = 0
        tv.keyboardType = .asciiCapable
        tv.autocorrectionType = .no
        tv.spellCheckingType = .no
        tv.autocapitalizationType = .none
        tv.inputAssistantItem.leadingBarButtonGroups  = []
        tv.inputAssistantItem.trailingBarButtonGroups = []

        // Attach the format toolbar as the keyboard's input accessory —
        // it slides up with the keyboard and takes no space when keyboard is hidden.
        let toolbar = FormatToolbar(controller: controller, onShowPalette: onShowPalette)
        let host = UIHostingController(rootView: toolbar)
        host.view.frame = CGRect(x: 0, y: 0, width: 0, height: 52)
        host.view.backgroundColor = .clear
        tv.inputAccessoryView = host.view
        context.coordinator.toolbarHost = host

        tv.attributedText = buildHighlightedText(text)
        controller.textView = tv
        return tv
    }

    func updateUIView(_ tv: UITextView, context: Context) {
        if tv.text != text {
            let range = tv.selectedRange
            tv.attributedText = buildHighlightedText(text)
            let clamped = min(range.location, tv.text.utf16.count)
            tv.selectedRange = NSRange(location: clamped, length: 0)
        }
        // Keep toolbar callbacks up to date
        context.coordinator.toolbarHost?.rootView = FormatToolbar(controller: controller, onShowPalette: onShowPalette)
        context.coordinator.parent = self
    }

    class Coordinator: NSObject, UITextViewDelegate {
        var parent: TypstEditor
        var toolbarHost: UIHostingController<FormatToolbar>?
        private var highlightWork: DispatchWorkItem?
        private var isHighlighting = false

        init(_ parent: TypstEditor) { self.parent = parent }

        func textViewDidChange(_ tv: UITextView) {
            guard !isHighlighting else { return }
            parent.text = tv.text

            let loc = tv.selectedRange.location
            let ns = tv.text as NSString

            // Slash detection
            if loc > 0, ns.substring(with: NSRange(location: loc - 1, length: 1)) == "/" {
                DispatchQueue.main.async { self.parent.onSlashTyped() }
            }

            // [[ wiki-link detection
            if loc >= 2, ns.substring(with: NSRange(location: loc - 2, length: 2)) == "[[" {
                DispatchQueue.main.async { self.parent.onWikiLinkTyped() }
            }

            // Debounced highlight
            highlightWork?.cancel()
            let item = DispatchWorkItem { [weak self, weak tv] in
                guard let self, let tv, !tv.text.isEmpty else { return }
                self.applyHighlight(tv)
            }
            highlightWork = item
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.12, execute: item)
        }

        private func applyHighlight(_ tv: UITextView) {
            isHighlighting = true
            let cursor = tv.selectedRange
            tv.attributedText = buildHighlightedText(tv.text)
            let len = tv.text.utf16.count
            tv.selectedRange = NSRange(location: min(cursor.location, len), length: cursor.length)
            isHighlighting = false
        }
    }
}

// ── Slash command model ───────────────────────────────────────────────────────

struct SlashCommand: Identifiable {
    let id: String
    let category: String
    let icon: String
    let name: String
    let description: String
    let syntax: String
    var wrapPrefix: String? = nil
    var wrapSuffix: String? = nil
}

private let allSlashCommands: [SlashCommand] = [
    .init(id: "h1",        category: "Heading",   icon: "textformat.size.larger",                  name: "Heading 1",      description: "Large section heading",    syntax: "= "),
    .init(id: "h2",        category: "Heading",   icon: "textformat.size",                         name: "Heading 2",      description: "Medium section heading",   syntax: "== "),
    .init(id: "h3",        category: "Heading",   icon: "textformat.size.smaller",                 name: "Heading 3",      description: "Small section heading",    syntax: "=== "),
    .init(id: "bold",      category: "Format",    icon: "bold",                                    name: "Bold",           description: "Strong emphasis",          syntax: "*bold*",        wrapPrefix: "*",          wrapSuffix: "*"),
    .init(id: "italic",    category: "Format",    icon: "italic",                                  name: "Italic",         description: "Light emphasis",           syntax: "_italic_",      wrapPrefix: "_",          wrapSuffix: "_"),
    .init(id: "code",      category: "Format",    icon: "chevron.left.forwardslash.chevron.right", name: "Inline Code",    description: "Monospace code snippet",   syntax: "`code`",        wrapPrefix: "`",          wrapSuffix: "`"),
    .init(id: "strike",    category: "Format",    icon: "strikethrough",                           name: "Strikethrough",  description: "Struck-through text",      syntax: "#strike[text]", wrapPrefix: "#strike[",   wrapSuffix: "]"),
    .init(id: "bullet",    category: "List",      icon: "list.bullet",                             name: "Bullet List",    description: "Unordered list item",      syntax: "- "),
    .init(id: "numbered",  category: "List",      icon: "list.number",                             name: "Numbered List",  description: "Ordered list item",        syntax: "+ "),
    .init(id: "checkbox",  category: "List",      icon: "checkmark.square",                        name: "Checkbox",       description: "Checklist item (auto-imports cheq)", syntax: "- [ ] "),
    .init(id: "codeblock", category: "Block",     icon: "curlybraces",                             name: "Code Block",     description: "Multi-line code block",    syntax: "```\n\n```"),
    .init(id: "math",      category: "Block",     icon: "function",                                name: "Equation",       description: "Inline math expression",   syntax: "$x = y$",       wrapPrefix: "$",          wrapSuffix: "$"),
    .init(id: "mathblock", category: "Block",     icon: "sum",                                     name: "Math Block",     description: "Display-mode equation",    syntax: "$ x = y $"),
    .init(id: "quote",     category: "Block",     icon: "text.quote",                              name: "Block Quote",    description: "Indented quotation",       syntax: "#quote[\n\n]"),
    .init(id: "divider",   category: "Block",     icon: "minus",                                   name: "Divider",        description: "Horizontal rule",          syntax: "\n---\n"),
    .init(id: "wikilink",  category: "Link",      icon: "link.badge.plus",                         name: "Wiki Link",      description: "Link to another note",     syntax: "[[]]"),
    .init(id: "url",       category: "Link",      icon: "globe",                                   name: "URL Link",       description: "External hyperlink",       syntax: "#link(\"url\")[text]"),
    .init(id: "tags",      category: "Meta",      icon: "tag",                                     name: "Tags",           description: "Add tags to this note",    syntax: "// @tags: "),
]

// ── Slash command palette ─────────────────────────────────────────────────────

struct SlashCommandPalette: View {
    @Binding var isPresented: Bool
    let onSelect: (SlashCommand) -> Void

    @State private var search = ""

    private var sections: [(name: String, commands: [SlashCommand])] {
        let pool = search.isEmpty ? allSlashCommands : allSlashCommands.filter {
            $0.name.localizedCaseInsensitiveContains(search) ||
            $0.category.localizedCaseInsensitiveContains(search) ||
            $0.description.localizedCaseInsensitiveContains(search)
        }
        let grouped = Dictionary(grouping: pool, by: \.category)
        return ["Heading", "Format", "List", "Block", "Link", "Meta"].compactMap { cat in
            guard let cmds = grouped[cat] else { return nil }
            return (cat, cmds)
        }
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(sections, id: \.name) { section in
                    Section(section.name) {
                        ForEach(section.commands) { cmd in
                            Button {
                                isPresented = false
                                onSelect(cmd)
                            } label: {
                                HStack(spacing: 12) {
                                    let iconView = Image(systemName: cmd.icon)
                                        .font(.system(size: 16))
                                        .frame(width: 34, height: 34)
                                        .background(.ultraThinMaterial)
                                        .clipShape(RoundedRectangle(cornerRadius: 8))
                                    iconView.foregroundStyle(.tint)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(cmd.name).font(.system(size: 15, weight: .medium))
                                        Text(cmd.description).font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                                .foregroundStyle(.primary)
                            }
                        }
                    }
                }
            }
            .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search commands…")
            .navigationTitle("Insert Block")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { isPresented = false }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

// ── Format toolbar ────────────────────────────────────────────────────────────

struct FormatToolbar: View {
    let controller: EditorController
    let onShowPalette: () -> Void

    private let quickChars = ["=", "*", "_", "-", "+", "["]

    var body: some View {
        HStack(spacing: 0) {
            // Pinned Commands button
            Button(action: onShowPalette) {
                HStack(spacing: 5) {
                    Image(systemName: "slash.circle.fill")
                        .font(.system(size: 14, weight: .semibold))
                    Text("Commands")
                        .font(.system(size: 13, weight: .semibold))
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color.accentColor.opacity(0.13))
                .foregroundStyle(.tint)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .padding(.leading, 12)
            .padding(.trailing, 6)
            .fixedSize()                    // don't let it shrink

            Rectangle()
                .fill(Color.secondary.opacity(0.25))
                .frame(width: 1, height: 22)

            // Scrollable char buttons
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 4) {
                    ForEach(quickChars, id: \.self) { ch in
                        Button { controller.insert(ch) } label: {
                            Text(ch)
                                .font(.system(size: 17, weight: .regular, design: .monospaced))
                                .frame(width: 36, height: 36)
                                .background(.ultraThinMaterial)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                        .foregroundStyle(.primary)
                    }
                }
                .padding(.horizontal, 8)
            }
        }
        .padding(.vertical, 8)
        .background(.ultraThinMaterial)
    }
}

// ── Wiki link picker ──────────────────────────────────────────────────────────

struct WikiLinkPicker: View {
    let notes: [Note]
    @Binding var isPresented: Bool
    let onSelect: (Note) -> Void
    @State private var search = ""

    private var filtered: [Note] {
        search.isEmpty ? notes : notes.filter { $0.title.localizedCaseInsensitiveContains(search) }
    }

    var body: some View {
        NavigationStack {
            List(filtered) { note in
                Button {
                    isPresented = false
                    onSelect(note)
                } label: {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(note.title)
                            .foregroundStyle(.primary)
                            .font(.system(size: 15, weight: .medium))
                        if !note.tags.isEmpty {
                            Text(note.tags.map { "#\($0)" }.joined(separator: "  "))
                                .font(.caption)
                                .foregroundStyle(.tint)
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
            .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search notes…")
            .navigationTitle("Link to Note")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { isPresented = false }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

// ── Note editor view ──────────────────────────────────────────────────────────

struct NoteEditorView: View {
    @EnvironmentObject var noteStore: NoteStore
    let note: Note
    @State private var localBody = ""
    @StateObject private var controller = EditorController()
    @State private var showCommandPalette = false
    @State private var showWikiLinkPicker = false

    var body: some View {
        TypstEditor(
            text: $localBody,
            controller: controller,
            onSlashTyped: { showCommandPalette = true },
            onWikiLinkTyped: { showWikiLinkPicker = true },
            onShowPalette: { showCommandPalette = true }
        )
        .onChange(of: localBody) { _, newValue in noteStore.updateBody(newValue) }
        .background(backgroundGradient)
        .sheet(isPresented: $showCommandPalette) {
            SlashCommandPalette(isPresented: $showCommandPalette) { cmd in
                if cmd.id == "checkbox" {
                    controller.insertChecklistItem(replacingSlash: true)
                } else {
                    controller.insert(cmd.syntax,
                                      wrapPrefix: cmd.wrapPrefix,
                                      wrapSuffix: cmd.wrapSuffix,
                                      replacingSlash: true)
                }
            }
        }
        .sheet(isPresented: $showWikiLinkPicker) {
            WikiLinkPicker(notes: noteStore.notes.filter { $0.id != note.id },
                           isPresented: $showWikiLinkPicker) { picked in
                controller.insertWikiLink(title: picked.title)
            }
        }
        .onAppear { localBody = note.body }
        .onChange(of: note.id) { _, _ in localBody = note.body }
    }
}
