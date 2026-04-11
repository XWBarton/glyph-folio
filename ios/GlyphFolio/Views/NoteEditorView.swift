import SwiftUI
import UIKit
import PhotosUI

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

private func makeRule(_ pattern: String, _ light: String? = nil, dark: String? = nil,
                      bold: Bool = false, italic: Bool = false,
                      options: NSRegularExpression.Options = [.anchorsMatchLines]) -> TokenRule {
    let color: UIColor? = light.map { lightHex in
        let darkHex = dark ?? lightHex
        return UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: darkHex) : UIColor(hex: lightHex) }
    }
    let regex = try! NSRegularExpression(pattern: pattern, options: options)
    return TokenRule(pattern: regex, color: color, bold: bold, italic: italic)
}

private let tokenRules: [TokenRule] = [
    makeRule(#"//[^\n]*"#,              "9ca3af", dark: "6b7280",  italic: true),           // comment
    makeRule(#"^---$"#,                 "d1d5db", dark: "4b5563"),                          // hr
    makeRule(#"\$[^\$\n]+\$"#,         "c2410c", dark: "fb923c"),                          // inline math
    makeRule(#"```[\s\S]*?```"#,        "0f766e", dark: "2dd4bf",  options: []),            // code block
    makeRule(#"`[^`\n]+`"#,            "0f766e", dark: "2dd4bf"),                          // inline code
    makeRule(#"\"[^\"\n]*\""#,         "059669", dark: "34d399"),                          // string
    makeRule(#"^[-+]\s"#,              "2563eb", dark: "93c5fd",  bold: true),             // list marker
    makeRule(#"^={1,6}\s.+$"#,         "1d4ed8", dark: "60a5fa",  bold: true),             // heading
    makeRule(#"_[^_\n]+_"#,            "374151", dark: "cbd5e1",  italic: true),           // italic
    makeRule(#"\*[^\*\n]+\*"#,         "111827", dark: "f1f5f9",  bold: true),             // bold
    makeRule(#"#(set|let|show|if|else|for|while|import|include|return)\b"#,
             "7c3aed", dark: "a78bfa",  bold: true),                                        // keyword
    makeRule(#"#[a-zA-Z_][a-zA-Z0-9_]*"#, "0369a1", dark: "38bdf8"),                      // function
    makeRule(#"@[a-zA-Z_][a-zA-Z0-9_:.-]*"#, "be185d", dark: "f472b6"),                   // reference
]

private let adaptiveForeground = UIColor { tc in
    tc.userInterfaceStyle == .dark ? UIColor(hex: "e2e8f0") : UIColor(hex: "1a1d2e")
}

private func buildHighlightedText(_ text: String) -> NSAttributedString {
    let ns   = text as NSString
    let full = NSRange(location: 0, length: ns.length)

    let result = NSMutableAttributedString(string: text)
    result.addAttributes([
        .font:            baseFont,
        .foregroundColor: adaptiveForeground,
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

    /// Replaces the [[ typed before the cursor with [[title]], consuming auto-closed ]] if present.
    func insertWikiLink(title: String) {
        guard let tv = textView else { return }
        let cursorLoc = tv.selectedRange.location
        let ns = tv.text as NSString
        let searchRange = NSRange(location: 0, length: cursorLoc)
        let bracketRange = ns.range(of: "[[", options: .backwards, range: searchRange)
        guard bracketRange.location != NSNotFound else { return }
        // If the editor auto-closed [[ → [[]], the ]] sits right after the cursor — consume it
        var endLoc = cursorLoc
        if cursorLoc + 2 <= ns.length,
           ns.substring(with: NSRange(location: cursorLoc, length: 2)) == "]]" {
            endLoc = cursorLoc + 2
        }
        guard let start = tv.position(from: tv.beginningOfDocument, offset: bracketRange.location),
              let end   = tv.position(from: tv.beginningOfDocument, offset: endLoc),
              let range = tv.textRange(from: start, to: end) else { return }
        tv.replace(range, withText: "[[\(title)]]")
    }

    /// Completes the current partial tag on the // @tags: line.
    func insertTagCompletion(_ tag: String) {
        guard let tv = textView else { return }
        let cursorLoc = tv.selectedRange.location
        let ns = tv.text as NSString
        let before = ns.substring(with: NSRange(location: 0, length: cursorLoc))
        let nsB = before as NSString
        let colonIdx = nsB.range(of: ":", options: .backwards).location
        let commaIdx = nsB.range(of: ",", options: .backwards).location
        let sepIdx: Int
        if colonIdx == NSNotFound && commaIdx == NSNotFound {
            sepIdx = NSNotFound
        } else if colonIdx == NSNotFound {
            sepIdx = commaIdx
        } else if commaIdx == NSNotFound {
            sepIdx = colonIdx
        } else {
            sepIdx = max(colonIdx, commaIdx)
        }
        var replaceStart = sepIdx != NSNotFound ? sepIdx + 1 : cursorLoc
        // skip leading whitespace
        while replaceStart < cursorLoc && ns.character(at: replaceStart) == 32 { replaceStart += 1 }
        guard let start = tv.position(from: tv.beginningOfDocument, offset: replaceStart),
              let end   = tv.position(from: tv.beginningOfDocument, offset: cursorLoc),
              let range = tv.textRange(from: start, to: end) else { return }
        tv.replace(range, withText: tag)
        tv.delegate?.textViewDidChange?(tv)
    }

    /// Navigates to the // @tags: line (or inserts one at the top if absent).
    /// If tags already exist, appends ", " so the user can type another tag.
    func insertOrFocusTags(replacingSlash: Bool = false) {
        guard let tv = textView else { return }

        // Remove the triggering / if called from slash palette
        if replacingSlash,
           let sel = tv.selectedTextRange,
           let prev = tv.position(from: sel.start, offset: -1),
           let prevRange = tv.textRange(from: prev, to: sel.start),
           tv.text(in: prevRange) == "/" {
            tv.replace(prevRange, withText: "")
        }

        let ns = NSMutableString(string: tv.text ?? "")
        let marker = "// @tags:"
        let markerRange = ns.range(of: marker)
        var cursorPos: Int

        if markerRange.location != NSNotFound {
            let contentStart = markerRange.location + markerRange.length
            let searchFrom = NSRange(location: contentStart, length: ns.length - contentStart)
            let nlRange = ns.range(of: "\n", options: [], range: searchFrom)
            let lineEnd = nlRange.location != NSNotFound ? nlRange.location : ns.length
            let content = ns.substring(with: NSRange(location: contentStart, length: lineEnd - contentStart))
            let trimmed = content.trimmingCharacters(in: .whitespaces)

            if trimmed.isEmpty {
                // No tags yet — ensure a space is present and park cursor after it
                if !content.hasPrefix(" ") { ns.insert(" ", at: contentStart) }
                cursorPos = contentStart + 1
            } else {
                // Existing tags — append ", " so the user types the next tag
                ns.insert(", ", at: lineEnd)
                cursorPos = lineEnd + 2
            }

            tv.text = ns as String
            let safe = min(cursorPos, ns.length)
            tv.selectedRange = NSRange(location: safe, length: 0)
            // Scroll tags line into view
            tv.scrollRangeToVisible(NSRange(location: markerRange.location, length: 0))
        } else {
            // No tags line — insert one at the very top
            let header = "// @tags: \n"
            ns.insert(header, at: 0)
            tv.text = ns as String
            cursorPos = 10 // right after "// @tags: "
            tv.selectedRange = NSRange(location: cursorPos, length: 0)
            tv.scrollRangeToVisible(NSRange(location: 0, length: 1))
        }

        tv.delegate?.textViewDidChange?(tv)
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
    var onWikiLinkTapped: (String) -> Void = { _ in }
    var onTagPartialChanged: (String?) -> Void = { _ in }

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

        // Wikilink tap: detect [[...]] at the tapped character position
        let wikiTap = UITapGestureRecognizer(target: context.coordinator,
                                             action: #selector(Coordinator.handleWikiLinkTap(_:)))
        wikiTap.cancelsTouchesInView = false
        wikiTap.delegate = context.coordinator
        tv.addGestureRecognizer(wikiTap)

        // When the keyboard appears the view shrinks; UITextView needs a nudge to
        // recalculate whether it can scroll with the new (smaller) frame.
        NotificationCenter.default.addObserver(
            context.coordinator,
            selector: #selector(Coordinator.keyboardDidShow),
            name: UIResponder.keyboardDidShowNotification,
            object: nil
        )

        return tv
    }

    func updateUIView(_ tv: UITextView, context: Context) {
        if tv.text != text {
            let range = tv.selectedRange
            let offset = tv.contentOffset
            tv.attributedText = buildHighlightedText(text)
            let clamped = min(range.location, tv.text.utf16.count)
            tv.selectedRange = NSRange(location: clamped, length: 0)
            // Restore scroll position and ensure UITextView knows it can scroll
            tv.contentOffset = offset
            tv.isScrollEnabled = false
            tv.isScrollEnabled = true
        }
        // Keep toolbar callbacks up to date
        context.coordinator.toolbarHost?.rootView = FormatToolbar(controller: controller, onShowPalette: onShowPalette)
        context.coordinator.parent = self
    }

    class Coordinator: NSObject, UITextViewDelegate, UIGestureRecognizerDelegate {
        var parent: TypstEditor
        var toolbarHost: UIHostingController<FormatToolbar>?
        private var highlightWork: DispatchWorkItem?
        private var isHighlighting = false

        init(_ parent: TypstEditor) { self.parent = parent }

        // Continue list/checkbox prefixes on return; double-return (empty item) exits.
        func textView(_ tv: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
            // Auto-close bracket pairs
            let pairs: [String: String] = ["[": "]", "(": ")", "{": "}"]
            if let closing = pairs[text], range.length == 0 {
                let mns = NSMutableString(string: tv.text ?? "")
                mns.insert(text + closing, at: range.location)
                tv.text = mns as String
                tv.selectedRange = NSRange(location: range.location + 1, length: 0)
                tv.delegate?.textViewDidChange?(tv)
                return false
            }
            // Overtype: skip past auto-inserted closing bracket instead of inserting a duplicate
            let closings: Set<String> = ["]", ")", "}"]
            if closings.contains(text), range.length == 0 {
                let ns = tv.text as NSString
                if range.location < ns.length,
                   ns.substring(with: NSRange(location: range.location, length: 1)) == text {
                    tv.selectedRange = NSRange(location: range.location + 1, length: 0)
                    return false
                }
            }
            guard text == "\n" else { return true }
            let ns = tv.text as NSString
            let cursor = range.location

            // Walk back to find the start of the current line
            var lineStart = cursor
            while lineStart > 0 && ns.character(at: lineStart - 1) != ("\n" as NSString).character(at: 0) {
                lineStart -= 1
            }
            let currentLine = ns.substring(with: NSRange(location: lineStart, length: cursor - lineStart))

            // (detect prefix, what to insert for the next item)
            let continuations: [(String, String)] = [
                ("- [ ] ", "- [ ] "),
                ("- [x] ", "- [ ] "),
                ("- ",     "- "),
                ("+ ",     "+ "),
            ]
            for (detect, insert) in continuations {
                guard currentLine.hasPrefix(detect) else { continue }
                let afterPrefix = String(currentLine.dropFirst(detect.count))
                let mns = NSMutableString(string: tv.text)
                if afterPrefix.trimmingCharacters(in: .whitespaces).isEmpty {
                    // Empty item — exit list mode: remove the prefix, just break the line
                    mns.replaceCharacters(in: NSRange(location: lineStart, length: cursor - lineStart), with: "")
                    tv.text = mns as String
                    tv.selectedRange = NSRange(location: lineStart, length: 0)
                } else {
                    // Non-empty item — continue the list
                    let insertion = "\n\(insert)"
                    mns.insert(insertion, at: cursor)
                    tv.text = mns as String
                    let newPos = min(cursor + (insertion as NSString).length, mns.length)
                    tv.selectedRange = NSRange(location: newPos, length: 0)
                }
                tv.delegate?.textViewDidChange?(tv)
                return false
            }

            // Table row continuation: line is one or more [cell] cells separated by commas
            let trimmed = currentLine.trimmingCharacters(in: .whitespaces)
            if !trimmed.isEmpty,
               let regex = try? NSRegularExpression(pattern: #"^(\[[^\]]*\],?\s*)+"#),
               let _ = regex.firstMatch(in: trimmed, range: NSRange(trimmed.startIndex..., in: trimmed)) {
                let cellRegex = try? NSRegularExpression(pattern: #"\[[^\]]*\]"#)
                let cellCount = cellRegex?.numberOfMatches(in: trimmed, range: NSRange(trimmed.startIndex..., in: trimmed)) ?? 0
                if cellCount > 0 {
                    let newRow = (Array(repeating: "[]", count: cellCount).joined(separator: ", ")) + ","
                    let insertion = "\n\(newRow)"
                    let mns = NSMutableString(string: tv.text)
                    mns.insert(insertion, at: cursor)
                    tv.text = mns as String
                    // Park cursor inside the first [] of the new row
                    let newPos = cursor + 2  // after "\n["
                    tv.selectedRange = NSRange(location: min(newPos, mns.length), length: 0)
                    tv.delegate?.textViewDidChange?(tv)
                    return false
                }
            }

            return true
        }

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

            // @tags: partial detection — find the start of the current line
            var lineStart = loc
            while lineStart > 0 && ns.character(at: lineStart - 1) != 10 { lineStart -= 1 } // 10 = '\n'
            let currentLine = ns.substring(with: NSRange(location: lineStart, length: max(0, loc - lineStart)))
            if currentLine.hasPrefix("// @tags:") {
                let afterSep = currentLine.components(separatedBy: CharacterSet(charactersIn: ":,")).last ?? ""
                let partial = afterSep.trimmingCharacters(in: .whitespaces)
                DispatchQueue.main.async { self.parent.onTagPartialChanged(partial) }
            } else {
                DispatchQueue.main.async { self.parent.onTagPartialChanged(nil) }
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
            let offset = tv.contentOffset
            tv.attributedText = buildHighlightedText(tv.text)
            let len = tv.text.utf16.count
            tv.selectedRange = NSRange(location: min(cursor.location, len), length: cursor.length)
            // Restore scroll position and ensure UITextView knows it can scroll
            tv.contentOffset = offset
            tv.isScrollEnabled = false
            tv.isScrollEnabled = true
            isHighlighting = false
        }

        @objc func keyboardDidShow() {
            guard let tv = parent.controller.textView else { return }
            // Toggle isScrollEnabled to force UITextView to recalculate whether the
            // content (now larger than the keyboard-shrunk frame) needs scrolling.
            tv.isScrollEnabled = false
            tv.isScrollEnabled = true
        }

        // Allow simultaneous recognition with UITextView's built-in gestures
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }

        @objc func handleWikiLinkTap(_ recognizer: UITapGestureRecognizer) {
            guard let tv = recognizer.view as? UITextView else { return }
            let pt = recognizer.location(in: tv)
            let adjustedPt = CGPoint(
                x: pt.x - tv.textContainerInset.left,
                y: pt.y - tv.textContainerInset.top
            )
            let charIndex = tv.layoutManager.characterIndex(
                for: adjustedPt,
                in: tv.textContainer,
                fractionOfDistanceBetweenInsertionPoints: nil
            )
            let text = tv.text ?? ""
            guard let regex = try? NSRegularExpression(pattern: #"\[\[([^\]]+)\]\]"#) else { return }
            let nsText = text as NSString
            for match in regex.matches(in: text, range: NSRange(location: 0, length: nsText.length)) {
                guard NSLocationInRange(charIndex, match.range), match.numberOfRanges > 1 else { continue }
                let title = nsText.substring(with: match.range(at: 1))
                // Dismiss keyboard immediately so it doesn't flash open during navigation
                tv.resignFirstResponder()
                parent.onWikiLinkTapped(title)
                return
            }
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
    .init(id: "datetime",  category: "Meta",      icon: "calendar.clock",                          name: "Date & Time",    description: "Insert current date and time",    syntax: ""),
    .init(id: "image",     category: "Media",     icon: "photo",                                   name: "Image",          description: "Insert image from photo library", syntax: ""),
    .init(id: "bookmark",  category: "Media",     icon: "bookmark",                                name: "Web Bookmark",   description: "Fetch page title & description from URL", syntax: ""),
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
        return ["Format", "List", "Block", "Link", "Meta", "Media", "Heading"].compactMap { cat in
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

    private let quickChars = ["=", "*", "_", "-", "+", "[", "(", "#"]

    var body: some View {
        HStack(spacing: 0) {
            // Keyboard dismiss
            Button {
                UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder),
                                                to: nil, from: nil, for: nil)
            } label: {
                Image(systemName: "keyboard.chevron.compact.down")
                    .font(.system(size: 15))
                    .frame(width: 36, height: 36)
                    .background(.ultraThinMaterial)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .foregroundStyle(.secondary)
            .padding(.leading, 12)
            .padding(.trailing, 6)
            .fixedSize()

            Rectangle()
                .fill(Color.secondary.opacity(0.25))
                .frame(width: 1, height: 22)

            // Commands button (icon only)
            Button(action: onShowPalette) {
                Image(systemName: "slash.circle.fill")
                    .font(.system(size: 15))
                    .frame(width: 36, height: 36)
                    .background(Color.accentColor.opacity(0.13))
                    .foregroundStyle(.tint)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .padding(.leading, 8)
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

// ── Tag suggestion bar ────────────────────────────────────────────────────────

struct TagSuggestionBar: View {
    let suggestions: [String]
    let onSelect: (String) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(suggestions, id: \.self) { tag in
                    Button {
                        onSelect(tag)
                    } label: {
                        Text("#\(tag)")
                            .font(.system(size: 13, weight: .medium))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(Color.accentColor.opacity(0.12))
                            .foregroundStyle(.tint)
                            .clipShape(Capsule())
                            .overlay(Capsule().stroke(Color.accentColor.opacity(0.25), lineWidth: 1))
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
        }
        .background(.ultraThinMaterial)
        .transition(.move(edge: .bottom).combined(with: .opacity))
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
    @State private var showImagePicker = false
    @State private var pickerItem: PhotosPickerItem? = nil
    @State private var isUploadingImage = false
    @State private var imageUploadError: String? = nil
    @State private var tagSuggestions: [String] = []
    @State private var showBookmarkInput = false
    @State private var bookmarkURL = ""

    var body: some View {
        ZStack(alignment: .bottom) {
        TypstEditor(
            text: $localBody,
            controller: controller,
            onSlashTyped: { showCommandPalette = true },
            onWikiLinkTyped: { showWikiLinkPicker = true },
            onShowPalette: { showCommandPalette = true },
            onWikiLinkTapped: { title in
                Task {
                    if let target = noteStore.notes.first(where: {
                        $0.title.lowercased() == title.lowercased()
                    }) {
                        await noteStore.select(target)
                    }
                }
            },
            onTagPartialChanged: { partial in
                guard let partial, !partial.isEmpty else {
                    if !tagSuggestions.isEmpty { withAnimation { tagSuggestions = [] } }
                    return
                }
                let allTags = Array(Set(noteStore.notes.flatMap(\.tags)))
                let lower = partial.lowercased()
                let filtered = allTags
                    .filter { $0.lowercased().hasPrefix(lower) && $0.lowercased() != lower }
                    .sorted()
                withAnimation { tagSuggestions = filtered }
            }
        )

        if !tagSuggestions.isEmpty {
            TagSuggestionBar(suggestions: tagSuggestions) { tag in
                controller.insertTagCompletion(tag)
            }
        }
        } // ZStack
        .onChange(of: localBody) { _, newValue in noteStore.updateBody(newValue) }
        .background(backgroundGradient)
        .sheet(isPresented: $showCommandPalette) {
            SlashCommandPalette(isPresented: $showCommandPalette) { cmd in
                if cmd.id == "image" {
                    // Brief delay ensures the command palette sheet is fully dismissed
                    // before presenting the photo picker, preventing presentation conflicts.
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                        showImagePicker = true
                    }
                } else if cmd.id == "bookmark" {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                        bookmarkURL = ""
                        showBookmarkInput = true
                    }
                } else if cmd.id == "datetime" {
                    let now = Date()
                    let datePart = now.formatted(.dateTime.month(.wide).day().year())
                    let timePart = now.formatted(.dateTime.hour().minute())
                    controller.insert("\(datePart) · \(timePart)", replacingSlash: true)
                } else if cmd.id == "checkbox" {
                    controller.insertChecklistItem(replacingSlash: true)
                } else if cmd.id == "tags" {
                    controller.insertOrFocusTags(replacingSlash: true)
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
        .photosPicker(isPresented: $showImagePicker, selection: $pickerItem, matching: .images)
        .onChange(of: pickerItem) { _, item in
            guard let item else { return }
            Task { await handlePickedPhoto(item) }
        }
        .alert("Image Upload Failed", isPresented: Binding(
            get: { imageUploadError != nil },
            set: { if !$0 { imageUploadError = nil } }
        )) {
            Button("OK", role: .cancel) { imageUploadError = nil }
        } message: {
            Text(imageUploadError ?? "")
        }
        .alert("Web Bookmark", isPresented: $showBookmarkInput) {
            TextField("https://example.com", text: $bookmarkURL)
                .keyboardType(.URL)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
            Button("Fetch") {
                let url = bookmarkURL.trimmingCharacters(in: .whitespaces)
                guard !url.isEmpty else { return }
                Task { await handleBookmark(url) }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Enter a URL to create a bookmark card")
        }
        .onAppear { localBody = note.body }
        .onChange(of: note.id) { _, _ in localBody = note.body }
    }

    private func handleBookmark(_ rawURL: String) async {
        let fullURL = rawURL.hasPrefix("http") ? rawURL : "https://\(rawURL)"
        guard let url = URL(string: fullURL) else { return }
        let domain = url.host?.replacingOccurrences(of: "www.", with: "") ?? fullURL

        // Default title = domain (never the raw URL — // in content mode is a Typst line comment)
        var pageTitle = domain
        var pageDesc  = ""
        var imagePath = ""

        if let (data, _) = try? await URLSession.shared.data(from: url) {
            let html = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) ?? ""
            let ns = html as NSString
            let len = NSRange(location: 0, length: ns.length)

            func firstCapture(_ pattern: String) -> String? {
                guard let re = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive, .dotMatchesLineSeparators]),
                      let m = re.firstMatch(in: html, range: len),
                      m.numberOfRanges > 1 else { return nil }
                let r = m.range(at: 1)
                guard r.location != NSNotFound else { return nil }
                return ns.substring(with: r)
            }

            let ogTitle  = firstCapture(#"<meta[^>]+property="og:title"[^>]+content="([^"]*)"[^>]*>"#)
                        ?? firstCapture(#"<meta[^>]+content="([^"]*)"[^>]+property="og:title"[^>]*>"#)
            let htmlTitle = firstCapture(#"<title>([^<]+)</title>"#)
            pageTitle = (ogTitle ?? htmlTitle ?? fullURL).trimmingCharacters(in: .whitespacesAndNewlines)

            let ogDesc   = firstCapture(#"<meta[^>]+property="og:description"[^>]+content="([^"]*)"[^>]*>"#)
                        ?? firstCapture(#"<meta[^>]+content="([^"]*)"[^>]+property="og:description"[^>]*>"#)
            let metaDesc = firstCapture(#"<meta[^>]+name="description"[^>]+content="([^"]*)"[^>]*>"#)
                        ?? firstCapture(#"<meta[^>]+content="([^"]*)"[^>]+name="description"[^>]*>"#)
            pageDesc = (ogDesc ?? metaDesc ?? "").trimmingCharacters(in: .whitespacesAndNewlines)

            // Fetch og:image and save as attachment (server mode only)
            if let ogImageStr = firstCapture(#"<meta[^>]+property="og:image"[^>]+content="([^"]*)"[^>]*>"#)
                             ?? firstCapture(#"<meta[^>]+content="([^"]*)"[^>]+property="og:image"[^>]*>"#),
               let ogImageURL = URL(string: ogImageStr),
               noteStore.syncMode == .server {
                if let (imgData, imgResp) = try? await URLSession.shared.data(from: ogImageURL) {
                    let ct = (imgResp as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Type") ?? ""
                    let ext = ct.contains("png") ? "png" : ct.contains("gif") ? "gif" : ct.contains("webp") ? "webp" : "jpg"
                    let filename = "bm-\(UUID().uuidString).\(ext)"
                    if let storedName = try? await noteStore.uploadAttachment(noteId: note.id, filename: filename, data: imgData) {
                        imagePath = "attachments/\(note.id)/\(storedName)"
                    }
                }
            }
        }

        // Escape text for Typst content mode: [], #, *, _ and // (line comment trigger)
        func esc(_ s: String) -> String {
            s.replacingOccurrences(of: "[",  with: "\\[")
             .replacingOccurrences(of: "]",  with: "\\]")
             .replacingOccurrences(of: "#",  with: "\\#")
             .replacingOccurrences(of: "*",  with: "\\*")
             .replacingOccurrences(of: "_",  with: "\\_")
             .replacingOccurrences(of: "//", with: "/\u{200B}/") // zero-width space breaks // comment
        }

        // Build text column: title → description → domain (Notion-style stacking)
        var textParts = ["#link(\"\(fullURL)\")[*\(esc(pageTitle))*]"]
        if !pageDesc.isEmpty { textParts.append("#text(size: 9pt, fill: luma(110))[\(esc(pageDesc))]") }
        textParts.append("#text(size: 8pt, fill: luma(160))[\(esc(domain))]")
        let textCol = textParts.joined(separator: "\\\n    ")

        let snippet: String
        if !imagePath.isEmpty {
            snippet = [
                "#block(stroke: 0.5pt + luma(215), radius: 6pt, inset: 10pt, width: 100%)[",
                "  #grid(columns: (1fr, 88pt), gutter: 10pt, align: (left + top, right + top),",
                "    [\(textCol)],",
                "    [#box(radius: 4pt, clip: true)[#image(\"\(imagePath)\", width: 88pt, height: 66pt, fit: \"cover\")]],",
                "  )",
                "]",
            ].joined(separator: "\n") + "\n"
        } else {
            snippet = [
                "#block(stroke: 0.5pt + luma(215), radius: 6pt, inset: (x: 12pt, y: 10pt), width: 100%)[",
                "  \(textCol)",
                "]",
            ].joined(separator: "\n") + "\n"
        }
        controller.insert(snippet, replacingSlash: false)
    }

    private func handlePickedPhoto(_ item: PhotosPickerItem) async {
        guard noteStore.syncMode == .server else {
            imageUploadError = "Image attachments require Server mode. Switch to Server sync in Settings."
            pickerItem = nil
            return
        }
        isUploadingImage = true
        defer { isUploadingImage = false; pickerItem = nil }
        do {
            guard let data = try await item.loadTransferable(type: Data.self) else { return }
            // Compress to JPEG for consistent cross-platform rendering
            let imageData: Data
            let filename: String
            if let uiImage = UIImage(data: data), let jpeg = uiImage.jpegData(compressionQuality: 0.82) {
                imageData = jpeg
                filename = "\(UUID().uuidString).jpg"
            } else {
                imageData = data
                filename = "\(UUID().uuidString).png"
            }
            let storedName = try await noteStore.uploadAttachment(noteId: note.id, filename: filename, data: imageData)
            let snippet = "\n#figure(\n  image(\"attachments/\(note.id)/\(storedName)\"),\n  caption: [],\n)\n"
            controller.insert(snippet)
        } catch {
            imageUploadError = "Upload failed: \(error.localizedDescription)"
        }
    }
}
