---
name: comic-strip
description: Write a comic strip in the Comic Chat studio format and return a link that opens it, rendered, in the editor. Use when the user wants a comic, a cartoon, or illustrated panels for a blog post, a slide, a changelog, a README, or a recap.
---

# Comic strip

A strip is a JSON document: a list of panels, each casting up to five characters from a fixed 1996 cartoon troupe. You write the document, validate it, and hand back a link that opens it in the studio.

## Steps

1. Read `reference/guidance.md`. It is short, it is the craft, and it says which of the other files you need.
2. Cast the strip by asking, not by browsing: `node <skill dir>/scripts/cast-query.mjs --register office --gesture shrug` narrows the troupe, and `cast-query.mjs dan margaret` prints everything those two can act. Faster and safer than reading the catalog.
3. Write the panels to a JSON file, naming characters, faces, poses, and backdrops only from what the query returned. Never invent a name.
4. Validate and get the link: `node <skill dir>/scripts/strip-link.mjs strip.json`. An error means the studio would reject that field, so fix it and rerun. A warning means the strip renders, but not the way you asked.
5. Hand back the link and the file path. The link opens the strip in the editor, where the user can retune any panel and export a PNG from the Save menu.

Add `--base http://localhost:5173` to point the link at a dev server instead of the public studio, and `--open` to also launch it in the default browser.

## Reference

| file | open it when |
| --- | --- |
| `reference/guidance.md` | before writing anything. Staging, camera, pacing, pairings, and the mistakes that only show up in the render |
| `scripts/cast-query.mjs` | casting. Ask it which characters own a pose or a face, or dump one character in full. Prefer this over reading the cast |
| `reference/cast.md` | browsing the whole troupe at once, or reading how faces and poses are named |
| `reference/backgrounds.md` | choosing where it is set. All nine backdrops, what each looks like, and which are ink and which are colour |
| `reference/catalog.json` | last resort. The machine authority both scripts already read for you, so you rarely need it open |

`cast-query.mjs` with no arguments prints its filters. A character's faces are stored as counts and its poses as names: `happy 3` means the `emotion` field takes `happy`, or `happy_1` to `happy_3` to pin one drawing. Poses are written exactly as the query prints them.

## Document

```json
{
  "version": 2,
  "columns": 4,
  "panels": [
    {
      "background": "field",
      "actors": [
        { "avatar": "dan", "text": "The build is green", "emotion": "happy" },
        { "avatar": "anna", "text": "On the first try?", "emotion": "scared", "facing": "left" }
      ]
    }
  ]
}
```

| level | field | values |
| --- | --- | --- |
| strip | `version` | `2` |
| | `columns` | 1 to 8 panels per row, default 4 |
| | `size` | `classic` or `modern` (default) |
| | `seed` | integer, fixes the engine's random choices |
| panel | `background` | a backdrop name, or omit for blank |
| | `camera` | `wide` (default) or `close` |
| | `zoom` | 0.5 to 2 |
| | `border` | `false` drops the panel frame |
| | `actors` | 1 to 5, in left to right order |
| actor | `avatar` | required, lowercase |
| | `text` | the balloon; omit for a silent character |
| | `mode` | `say` (default), `think`, `whisper`, `action` |
| | `emotion` | the face |
| | `gesture` | the body; omit and the face brings its own |
| | `facing` | `right` (default) or `left` |

## Limits

- Five actors and five balloons a panel, hard.
- The studio screens balloon text for profanity: a tripped panel is outlined, listed in the issues strip, and the export is blocked until it changes. The validator here cannot check that, so keep the copy clean and let the editor be the backstop.
- The whole strip travels inside the link, deflated, and the validator prints the byte count so you can see it. An eight panel strip lands around 500 bytes, far inside what browsers and the worker accept.
