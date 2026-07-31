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
5. Hand back the link and the file path. The link opens the strip in the editor, where the user can retune any panel and export it from the Save menu: a PNG sheet, a square PNG, an MP4 or GIF that plays the panels one at a time, or the JSON back out.

Links point at the public studio, `https://comics.remsky.art`. Add `--open` to also launch the link in the default browser.

When the comic-chat MCP tools are connected, prefer them: `get_bearings` carries the vocabulary, the whole cast, and the same craft as `reference/guidance.md`, so it stands in for steps 1 and 2. `create_strip` validates and returns a short link in one call, and `query_cast` lists exact pose names when you want to pin a gesture.

## Reference

| file | open it when |
| --- | --- |
| `reference/guidance.md` | before writing anything. Staging, camera, pacing, pairings, and the mistakes that only show up in the render |
| `scripts/cast-query.mjs` | casting. Ask it which characters own a pose or a face, or dump one character in full. Prefer this over reading the cast |
| `reference/cast.md` | browsing the whole troupe at once, or reading how faces and poses are named |
| `reference/backgrounds.md` | choosing where it is set. All eleven backdrops, what each looks like, and which are ink and which are colour |
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
        { "avatar": "dan", "text": "The build is green" },
        { "avatar": "anna", "text": "On the first try?!", "emotion": "scared", "facing": "left" }
      ]
    }
  ]
}
```

| level | field | values |
| --- | --- | --- |
| strip | `version` | `2` |
| | `columns` | 1 to 8 panels per row, default 4 |
| | `seed` | integer, fixes the engine's random choices |
| panel | `kind` | `scene` (default) or `title` |
| | `background` | a backdrop name, or omit for blank |
| | `camera` | `wide` (default) or `close` |
| | `zoom` | 0.5 to 2 |
| | `border` | `false` drops the panel frame |
| | `actors` | 1 to 5, in left to right order |
| actor | `avatar` | required, lowercase |
| | `text` | the balloon; omit for a silent character |
| | `mode` | `say` (default), `think`, `whisper`, `action` |
| | `emotion` | the face; name one for control, or omit on a speaking actor and the engine picks from the dialogue |
| | `gesture` | the body; omit and the face brings its own |
| | `facing` | `right` (default) or `left` |

## Title card

`"kind": "title"` turns a panel into the 1996 STARRING card: the title in the big font, a line under it, then one icon-and-name row per actor. It is a cover, so it goes first or not at all.

```json
{
  "kind": "title",
  "title": "SHIP IT ON FRIDAY",
  "actors": [
    { "avatar": "dan", "text": "Dan; who pushed" },
    { "avatar": "margaret" }
  ]
}
```

An actor's `text` is its credit line, not a balloon; leave it off and the card credits the character's own name. The card draws icons, so `emotion`, `gesture`, `facing`, and `mode` do nothing on it, and so do `background`, `camera`, `zoom`, and `border`. Blank `title` composes as `UNTITLED`, blank `starring` as `STARRING`; write your own `starring` when the credit should read `A STORY TOLD BY`. Keep the title short, roughly the length of `THE GANG'S ALL HERE`, or it wraps and pushes the cast off the card.

`footer` adds an optional line along the bottom of the card, the size of the `starring` line: `"footer": "Written by Margaret"` or `"footer": "A reflection on the times"`. It is off unless you write one. The cast never gives up a row for it: the line shrinks to whatever space is left under the credits, and on a card whose credits already reach the bottom edge it is dropped. One line, so keep it under about forty characters.

## Limits

- Five actors and five balloons a panel, hard. A title card credits five at most, the same cap.
- The studio screens balloon text, titles, and credit lines for profanity: a tripped panel is outlined, listed in the issues strip, and the export is blocked until it changes. The validator here cannot check that, so keep the copy clean and let the editor be the backstop.
- The whole strip travels inside the link, deflated, and the validator prints the byte count so you can see it. An eight panel strip lands around 500 bytes, far inside what browsers and the worker accept.
