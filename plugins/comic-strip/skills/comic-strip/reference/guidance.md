# Writing a strip that reads

Craft, in the order it bites. This is the how. Who exists, what each character can act, and where a strip can be set are all looked up separately; ask for a character's inventory rather than guessing at it.

## Staging, which is where strips go wrong

- The `actors` array is the seating. First actor stands at the left of the panel, next to its right, evenly spaced.
- Everyone faces right unless told otherwise, and `facing: "left"` flips the drawing. So the leftmost character already looks toward everyone else, and the rightmost has nobody on its right and looks out of the frame until you flip it. **In a two character panel, the second actor takes `facing: "left"`. Always. Whoever is talking unless there is a creative reason to have them look away and off-screen.**
- That is the whole model: face inward. Slot 0 inward is `right`, the last slot inward is `left`.
- Put `facing: "left"` on the first actor and it turns its back on the scene. Do that and leave the second on the default and both of them stare out of opposite edges, which is the single most common way a strip looks broken.
- Keep each character in the same slot for the whole strip. If the pitch comes from the left in panel 1, it comes from the left in panel 8. Swapping sides makes the reader re-find who is who.
- A pose points the way the character faces, so `point` with nobody to the right aims at empty frame. Point across at someone.

## Camera

`wide` is the default and the right answer most of the time: whole figures, small, with the backdrop open around them.

`close` scales the figure up and crops at the chest. The face carries, raised hands still show, legs are gone, and two characters nearly fill the frame. Spend it on a reaction or a punchline. Half a strip of `close` reads as monotonous.

`zoom` nudges the framing either way and is rarely needed. Reach for it only for dramatic effect, limited to cases with 1-2 speakers who have few words, to avoid visual overlap.

## Balloons

- One or two speakers a panel. Three is a crowd scene, not a conversation.
- Balloons stack in actor order and read top to bottom, so the setup belongs to an earlier slot and the punchline to the last speaker in the panel.
- About a dozen words a balloon. The balloon takes its space out of the art, so long lines bury the characters. Split a long thought across two panels. The validator warns past 90 characters and rejects past 200, and the studio errors if the balloons cannot be laid out at all.
- Balloons render in capitals. Write sentence case and let the engine shout.
- `mode`: `say` is a pointed balloon, `think` a cloud, `whisper` smaller type, `action` a tailless box. A caption panel is one actor with `mode: "action"`.
- Every actor is drawn whether it speaks or not, so a silent character is how you get a reaction in frame. Give the silent one an emotion; that is its whole performance.

## Cast discipline

- Two speakers carry a strip. A third body is for reactions.
- Keep the cast constant. A character who appears for one panel and is never seen again reads as a mistake, especially a creature standing wordlessly beside two people who have been talking for three panels.
- Naming `emotion` gives you exact control: pick the face, pin a variant, hold an expression across panels. Directing every face is how you get subtext, irony, and beats that work against the dialogue.
- Omitting `emotion` on a speaking actor lets the engine read the line and pick a face: caps and exclamation marks land shout or scared, greetings trigger a wave, calm text stays neutral. Useful for quick drafts or panels where the face should just follow the tone of the line. The engine picks face and torso together, so auto panels do get some pose variety.
- Vary the bodies too. The engine's auto-picked torso mostly stands, so a strip with no `gesture` anywhere can still look frozen body-down even if the faces change. Name a gesture on the beat panels: the pitch, the objection, the payoff.
- Cast against type when the brief wants a joke. The caveman explaining a deploy pipeline is the whole gag. When the brief wants a straight arc, a pitch that has to land or a recap someone will present, cast plainly and let the writing carry it.
- Most briefs are both: a straight arc that ends on a laugh. Cast it plainly and put the joke in the last balloon. Gag casting commits the whole strip to comedy from panel 1, which is usually not what a recap or a slide wants.

## Backdrop discipline

- Pick for tone, never for the subject. A conversation about databases works fine in a field.
- The backdrop is where the scene is, not how the beat feels. One conversation is one place. Hold it, and never flip back and forth for emphasis. `room`, `volcano`, `room`, `clouds` across four panels of one meeting reads as teleporting.
- Change it when time or place actually moves: after the ship, the next morning, back at the desk. A new topic inside the same conversation is not a move. One change in a four panel strip, two at most in eight.
- An eight panel arc that ends after something shipped wants exactly one change, at the panel where the time skip happens. Everything before it is one meeting.
- Blank is for a scene the set cannot place, and for one panel where you want the frame to go quiet. A strip that is blank end to end looks unfinished.

## Shapes

- **Four panels**: setup, turn, escalation, payoff.
- **Eight panels**: four beats of two, one idea a panel, with something landing at panel 4 as well as panel 8. Read as two rows of four, so panel 4 ends the top row and wants a small button of its own.
- **Two-hander**: one enthusiast, one skeptic, same two slots throughout. The most reliable shape there is, and the easiest to stage.
- **Lecture with a foil**: one character explains across three panels while a silent second reacts, face changing each time. The reactions are the joke; the lecture is just scaffolding.
- **Before and after**: two panels, same cast, same slots, backdrop changed. Good for a changelog or a migration.
- **Caption strip**: every panel one actor with `mode: "action"` and nobody speaking. Reads as narration over illustration. Useful for a README or a recap where dialogue would be forced.
- **Cold open**: panel 1 is a single character mid-thought with `mode: "think"`, then the second character arrives in panel 2 and the strip becomes a two-hander.

MP4 and GIF exports are also available in the editor, and hold each panel about 4 seconds in order, and fade the balloons in over the art about a half second in.

## The title card

`kind: "title"` is a cover: title, a STARRING line, and an icon-and-name row per character. It goes at panel 0 or nowhere, and the validator says so.

- It spends a panel on no story. A four panel strip with a card in front is three beats, so write it as (title) 1+ (comic panels) 3 or let the sheet run up to 1+7 etc (4 panels per row) if you want to fill the page.
- You can name the cast that carry the strip, or leave it empty for a simple title card.
- The credit line puts the script chosen names of the characters (the avatar names are generic art identifiers). If keeping it short (e.g Dan the Server Man), you could use those lines for comedic effect or framing.  
- `footer` is an optional bottom line, off by default: an authorship credit ("Written by ...") or a date. Use it when the strip is signed work; leave it out otherwise. It never costs a credit row, though a five-name cast can fill the card and drop it entirely
- Whether to use title is a creative choice. Usually it's not needed. e.g skip it for most cases. It can be used to set the framing/stage of the comic in advance where creatively beneficial, or for longer strips (8+)
## Pairings that work

Loose suggestions, not rules. Once a pair is chosen, query those two characters and read what they can actually act, which is the moment to find out one of them cannot shrug.

- `dan` and `margaret`: coworkers who have had this argument before. He pitches, she does not buy it.
- `dan` and `anna`: earnest and unimpressed. Anna's `bored` and `coy` do a lot of work silently.
- `kevin` and `susan`: the one with the apron and the one with the patience. Anything domestic.
- `sage` or `kwensa` with anybody young: a question asked plainly and answered plainly.
- `mike` selling, anyone else listening: he is a showman, so he oversells by default.
- `xeno` or `tiki` as the outsider who asks the obvious question. Their strangeness is the excuse for exposition.
- `cro` explaining something modern: the whole joke, and it wears out after one strip.
- `maynard` or `hugh` as an animal with opinions, next to a human pretending that is normal.
- `pedagog`, `glenda`, `rainbow`, `tux`, `waf`: one drawing each, they cannot react or pose, so cast them silent or as a face in the background.

Cast and backdrop:

- `field` or `room` behind anyone: ink on ink, the whole panel one drawing style. The most cohesive look in the set.
- `yellow` behind the last panel: cheap, loud, and it lands a punchline.
- `clouds` for relief and after the fact, `volcano` for a turn that is about to hurt, `den` for a conversation that is meant to feel comfortable, `space` for absurd scale.

## Before you hand it over

Read the strip back as a reader, not as the writer. The failures worth catching:

- Two characters in a panel with nobody facing anybody.
- A character that changed sides between panels.
- A backdrop that moved for a mood instead of a scene, or a strip with no backdrop at all.
- Four `close` panels in a row.
- The same explicit face on the same character three panels running (auto-derived faces vary on their own).
- Every figure standing in the same pose the whole way down, because no panel named a gesture and the engine's auto torso is plain standing.
- A walk-on who appears once.
- A balloon so long the art vanished under it.
