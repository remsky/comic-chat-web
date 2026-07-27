# Cast

What each character looks like and how much it can act. `catalog.json` is the authority on exact names and counts; this file is for casting.

Read this file when you want to see the whole troupe at once. When you already know what you need, ask instead: `scripts/cast-query.mjs --register young --emotion bored` narrows it, and `scripts/cast-query.mjs anna` prints one character's faces, poses, look, and register together. The script reads the table and the register bullets below, so both files always agree.

## Naming a face and a pose

The face and the body are named separately.

- `emotion` is the face. Faces are stored as counts, not names, so `"happy": 3` means `happy_1`, `happy_2`, and `happy_3` all exist even though the JSON never writes them out. Write either form in the field: bare `"emotion": "happy"` lets the engine pick one, and `"emotion": "happy_2"` pins that exact drawing. Pin it when a character holds one expression across panels and you do not want the face changing under you. An emotion missing from the entry means the character has no art for it and poses neutral.
- Omitting `gesture` is the safe default: the face arrives with its own torso, so the pose always matches the mood and can never be a pose the character lacks.
- But many emotions share a plain standing torso, so a strip of two people talking with no gesture anywhere comes out as the same two figures standing identically in every panel, however much the faces change. Name a gesture on the panels that carry a beat. One or two a strip is enough to stop it looking frozen.
- `gesture` is the body: a command (`wave`, `point`, `pointself`, `doublepoint`, `shrug`, `walkaway`, `walk`, `walkup`) or an `<emotion>_<n>` stance. Commands are not universal. They have to appear in that character's own `gestures` list, and most of the cast owns only `wave`, `point`, and `pointself`. A gesture the character lacks poses neutral, which the validator reports as a warning.
- An `aliases` entry means two names draw the same faces: `"shout": "angry"` on `connor` says its shout is its angry art. Both names work and neither looks different, so pick a genuinely different emotion when you want a different face.
- All of it is per character. `susan` draws five happy faces; `bolo` draws two and has no bored at all. Read the entry, not the global list.

## The troupe

Reading the range column:

- **full wheel**: art for all eight emotions. Anything less names the gaps.
- **one drawing**: a single sprite held for every emotion and every gesture. A silent extra, not a speaker who reacts.
- **X reuses Y**: the character draws X with the same faces as Y, so both names work and neither looks different. These are the `aliases` in `catalog.json`.
- Everyone with gestures has `wave`, `point`, and `pointself`. Anything beyond that is called out.

The art is 1996 black-and-white cartoon line work. `buck`, `kirby`, and `veronica` are full colour and stand out beside the rest of the cast.

| character | look | range |
| --- | --- | --- |
| anna | young woman, black bob, turtleneck and short skirt | full wheel |
| armando | beatnik in a beret, goatee and shades, black turtleneck, sandals | full wheel; angry reuses sad |
| bolo | lanky man, tall black pompadour, pale jacket, bolo tie | no bored |
| buck | freckled kid, spiked orange hair, tee and jeans (colour) | full wheel |
| connor | curved worm of a creature, tiny cap, stubby feet | no scared; no gesture commands at all; shout reuses angry |
| cro | caveman in a fur tunic, shaggy hair, barefoot | no sad |
| dan | office everyman, white shirt and tie, thinning curls | full wheel, shrugs; angry reuses sad |
| denise | woman with curly hair and hoop earrings, sweater and long skirt | no bored, no scared |
| glenda | grinning woman, long wavy hair | one drawing |
| hugh | shaggy wolf in a patterned dressing gown and slippers | full wheel |
| jordan | squat creature ringed with eyes, grass skirt | full wheel, no gesture commands; scared reuses happy, shout reuses sad |
| kevin | lanky guy, black tee, apron tied at the waist, heavy boots | no bored |
| kirby | bowl cut and round glasses in a red and blue motion capture suit (colour) | full wheel |
| kwensa | older woman in a striped headwrap and hoop earrings, long dress | full wheel; sad reuses scared |
| lance | someone with a paper bag over their head, loose shirt, sneakers | no happy, no laugh; the only one who walks (`walkaway`, `walkup`, `doublepoint`, `shrug`); shout reuses angry |
| lynnea | clubgoer in round dark shades, afro puff, tutu and boots | full wheel, one of the widest torso sets |
| margaret | heavy-set woman, big curls and a headband, striped tracksuit | full wheel |
| maynard | floppy-eared dog standing upright | no bored, the most torsos in the cast; shout reuses angry |
| mike | showman in a fez and bow tie, long nose, dinner jacket | full wheel, shrugs; bored reuses coy, sad reuses scared |
| pedagog | stern man in a shirt and tie, arms folded | one drawing |
| rainbow | grinning lizard playing a snare drum | one drawing |
| rebecca | glamour: curled updo, long black gown and gloves | full wheel, very wide torso set; sad reuses bored, shout reuses scared |
| sage | old bearded sage in a plain robe, barefoot | full wheel |
| scotty | black terrier's head on a man in a sweater and cap, walking stick | the most faces in the cast; coy reuses happy |
| susan | woman with big black hair and flowers in it, long dress | full wheel, shrugs, five distinct happy faces and five neutrals; bored reuses coy |
| tiki | carved tiki mask on a stick-thin body | full wheel |
| tongtyed | heavy-set man, glasses and a curl of hair, V-neck sweater | full wheel, shrugs; bored reuses coy, sad reuses scared |
| tux | gangly man in a dinner jacket and bow tie, spiky hair | one drawing |
| veronica | blonde ponytail under a backwards cap, olive bomber jacket (colour) | full wheel |
| waf | wide-mouthed frog-lizard on two legs | one drawing |
| xeno | grey alien, big black eyes, spindly limbs | full wheel |

`walk` is in the command list but no character in this cast owns the art, so it always poses neutral.

## Casting by register

Nobody here wears a uniform or carries a job, so register comes from clothes alone. Rough groupings, for when a brief needs a particular kind of person:

- **Office or professional**: `dan` and `denise` read closest to coworkers, `tongtyed` as the one who has been there longest, `pedagog` as a humourless authority (but one drawing only), `rebecca` and `tux` as formal to the point of black tie.
- **Ordinary adults, no setting implied**: `margaret`, `susan`, `kwensa`, `scotty`, `kevin`, `glenda`. Safe for a neighbour, a parent, a friend, a customer. `glenda` has one drawing, so she can stand there and nothing more.
- **Young**: `anna`, `buck`, `veronica`, `kirby`, `lynnea`. `buck` is a child; the rest read late teens to twenties.
- **Counterculture and outsiders**: `armando`, `bolo`, `lance`, `lynnea`.
- **Wise or elder**: `sage`, `kwensa`.
- **Showmen**: `mike`, `rebecca`, `bolo`. Good for anyone overselling something.
- **Creatures**, which read as comic by default whatever they say: `connor`, `cro`, `hugh`, `jordan`, `maynard`, `rainbow`, `tiki`, `waf`, `xeno`.

A creature in a straight scene is a joke whether you meant one or not. If the strip has to be taken at face value, cast humans.
