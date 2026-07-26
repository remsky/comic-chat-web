---
name: comic-strip
description: Write a comic strip in the Comic Chat studio format and return a link that opens it, rendered, in the editor. Use when the user wants a comic, a cartoon, or illustrated panels for a blog post, a slide, a changelog, a README, or a recap.
---

# Comic strip

A strip is a JSON document: a list of panels, each casting up to five characters from a fixed 1996 cartoon troupe. You write the document, validate it, and hand back a link that opens it in the studio.

## Steps

1. Read `reference/catalog.json`. It names every character, every emotion each one owns, every gesture, the backdrops, and the limits. It is the authority on names; never invent one. `reference/cast.md` says what the characters look like and which backdrop is which.
2. Write the panels to a JSON file.
3. Validate and get the link: `node <skill dir>/scripts/strip-link.mjs strip.json`. An error means the studio would reject that field, so fix it and rerun. A warning means the strip renders, but not the way you asked.
4. Hand back the link and the file path. The link opens the strip in the editor, where the user can retune any panel and export a PNG from the Save menu.

Add `--base http://localhost:5173` to point the link at a dev server instead of the public studio.

## Document

```json
{
  "version": 2,
  "columns": 4,
  "panels": [
    {
      "background": "room",
      "camera": "close",
      "actors": [
        { "avatar": "dan", "text": "The build is green", "emotion": "happy", "gesture": "wave" },
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
| | `actors` | 1 to 5 |
| actor | `avatar` | required, lowercase |
| | `text` | the balloon; omit for a silent character |
| | `mode` | `say` (default), `think`, `whisper`, `action` |
| | `emotion` | the face |
| | `gesture` | the body |
| | `facing` | `right` (default) or `left` |

## Naming a drawing

The face and the body are chosen separately.

- `emotion` is the face. Each character's catalog entry counts them: `"happy": 3` means `happy_1`, `happy_2`, and `happy_3` exist, and bare `happy` is whichever the engine reaches unasked. An emotion missing from that entry means the character has no art for it and will pose neutral.
- Omitting `gesture` is the good default. The face you asked for arrives with its own torso, and the engine uses it, so the pose already matches the mood. Name a gesture only to override that with something the line needs.
- `gesture` is the body: a command (`wave`, `point`, `pointself`, `doublepoint`, `shrug`, `walkaway`, `walk`, `walkup`) or an `<emotion>_<n>` stance. Commands are not universal either. They have to appear in that character's own `gestures` list, and in practice most of the cast owns only `wave`, `point`, and `pointself`. A gesture the character lacks poses neutral instead, which the validator reports as a warning rather than an error.
- An `aliases` entry means two names draw the same faces: `"shout": "angry"` on `connor` says its shout is its angry art. Both names work and neither looks different, so pick a genuinely different emotion when you want a different face.
- All of this is per character. `susan` draws five happy faces; `bolo` draws two and has no bored at all. Read the entry, not the global list.

## Writing panels that read

- One or two speakers a panel. Every actor is drawn whether it speaks or not, so cast a silent character when you want a reaction in frame.
- Keep the cast small and keep it constant. A silent reaction should come from someone already in the strip. A character who turns up for one panel and is never seen again reads as a mistake, especially a creature standing wordlessly next to two people who have been talking for three panels.
- Keep a balloon to about a dozen words. The balloon takes its space out of the art, so long lines bury the characters. Split a long thought across two panels. The validator warns past 90 characters, and the studio raises a real error if the balloons cannot be laid out in the panel at all.
- Balloons render in capitals. Write sentence case and let the engine shout.
- The `actors` array is the seating. The first actor stands at the left of the panel, the next to its right, and so on, evenly spaced. `facing` flips the drawing, and everything faces right unless told otherwise, so **the actor on the right is the one that needs `facing: "left"`**. This is about position, not about who is answering. When the reply comes from the character on the right, that character still goes last in the array and still takes `facing: "left"`. Put `facing: "left"` on the first actor and it turns its back on the scene, and if you then leave the second on the default both of them stare out of opposite edges.
- Keep each character in the same slot for the whole strip. If the pitch comes from the left in panel 1, it comes from the left in panel 8. Swapping sides mid-strip makes the reader re-find who is who.
- A pointing gesture points the way the character faces, so `point` on a character that has nobody to its right aims at empty frame. Point across at someone, not out of the panel.
- `camera`. `wide` draws the whole figure small, with the backdrop open around it, and it is the right default. `close` scales the figure up and crops it at the chest: the face carries, raised hands still show, legs and feet are gone, and two characters nearly fill the frame. Use `close` on a reaction or a punchline. Half a strip of it reads as monotonous.
- `mode`: `say` draws a pointed balloon, `think` a cloud, `whisper` smaller type, `action` a tailless box. A caption panel is one actor with `mode: "action"`.
- Pick a backdrop for tone, never for the subject. There is no kitchen and no meeting room in the set, so do not try to build one.
- Use a backdrop. Blank is a fallback for a scene the set cannot place, not the house style: a strip that is blank end to end looks unfinished, and the art was drawn to sit in a world. Read the backdrop table for tone and pick the one that fits the mood, then hold it. If more than half the panels are coming out blank, go back to the table and choose on feeling instead of on subject.
- The backdrop is where the scene is, not how the beat feels. One conversation is one place. Hold it until time or place genuinely moves, and never flip back and forth for emphasis: `room`, `volcano`, `room`, `clouds` across four panels of one meeting reads as teleporting. If a strip is two people talking, either stay in one backdrop or stay blank and change once, at the jump.
- Four panels: setup, turn, escalation, payoff. Eight: four beats of two, one idea a panel, with something landing at panel 4 as well as panel 8.
- Vary the faces. A strip where everyone wears bare `happy` reads like a form letter.
- Cast against type when the brief wants a joke. The caveman explaining a deploy pipeline is the whole gag. When the brief wants a straight arc, a pitch that has to land or a recap someone will present, cast plainly and let the writing carry it.

## Limits

- Five actors and five balloons a panel, hard.
- The studio screens balloon text for profanity: a tripped panel is outlined, listed in the issues strip, and the export is blocked until it changes. The validator here cannot check that, so keep the copy clean and let the editor be the backstop.
- The whole strip travels inside the link, so a long strip makes a long URL. That is normal, and the validator prints the byte count so you can see it. An eight panel strip lands near 2.5 KB, far inside what browsers and the worker accept. Only a strip of dozens of panels would be worth worrying about.
