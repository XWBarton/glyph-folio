package com.glyph.folio.model

object Tutorial {
    fun body(dateLabel: String): String = """
// @tags: tutorial
// = Getting Started
#text(9pt, fill: gray)[$dateLabel]
#line(length: 100%, stroke: 0.4pt + gray)

Notes start with a tag string that is commented out:
```typst
// @tags: testing, another-tag
```
Glyph Folio reads these tags so you can filter by them, but they are not rendered in your note.

#line(length: 100%)

The note title comes from the first primary header, but it can be overridden by a commented primary header below the tag comment.

```typst
// = Tutorial Note
```

#line(length: 100%)

= Basic Typst Formatting
\
#table(
  columns: (1fr, 1fr, 2fr),
  [*Symbol*], [*Function*], [*Note*],
  [`=`], [Header], [h1 is =, h2 is ==, h3 is === etc],
  [`*Glyph Folio*`], [Bold], [Wrap a word in stars to bold it],
  [`_Glyph Folio_`], [Italic], [Wrap a word in underscores to italicise it],
  [`-`], [Bullet lists], [],
  [`+`], [Ordered lists], [],
  [`//`], [Comment], [Text after this will not be rendered],
)

= Glyph Folio on Android

- Type `/` to open the command palette for headings, lists, math, code blocks and more.
- `/check` imports the `cheq` package for pretty checkboxes.
- Link notes with `[[Note Title]]` — tap a link to open that note.
- In server mode, open the menu and choose *Preview PDF* to compile the note.
""".trimStart()
}
