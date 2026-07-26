# Cast and backdrops

What each character looks like and how much it can act. `catalog.json` is the authority on exact names and counts; this file is for casting.

Reading the range column:

- **full wheel**: art for all eight emotions. Anything less names the gaps.
- **one drawing**: a single sprite held for every emotion and every gesture. A silent extra, not a speaker who reacts.
- **X reuses Y**: the character draws X with the same faces as Y, so both names work and neither looks different. These are the `aliases` in `catalog.json`.
- Everyone with gestures has `wave`, `point`, and `pointself`. Anything beyond that is called out.

The art is 1996 black-and-white cartoon line work. `buck`, `kirby`, and `veronica` are full colour and stand out beside the rest of the cast; the colour backdrops behind monochrome characters are normal and read fine.

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

Nobody in this cast wears a uniform or carries a job, so register comes from clothes alone. Rough groupings, for when a brief needs a particular kind of person:

- **Office or professional**: `dan` and `denise` read closest to coworkers, `tongtyed` as the one who has been there longest, `pedagog` as a humourless authority (but one drawing only), `rebecca` and `tux` as formal to the point of black tie.
- **Ordinary adults, no setting implied**: `margaret`, `susan`, `kwensa`, `scotty`. Safe for a neighbour, a parent, a friend, a customer.
- **Young**: `anna`, `buck`, `veronica`, `kirby`, `lynnea`. `buck` is a child; the rest read late teens to twenties.
- **Counterculture and outsiders**: `armando`, `bolo`, `lance`, `lynnea`.
- **Wise or elder**: `sage`, `kwensa`.
- **Showmen**: `mike`, `rebecca`, `bolo`. Good for anyone overselling something.
- **Creatures**, which read as comic by default whatever they say: `connor`, `cro`, `hugh`, `jordan`, `maynard`, `rainbow`, `tiki`, `waf`, `xeno`.

A creature in a straight scene is a joke whether you meant one or not. If the strip has to be taken at face value, cast humans.

## Backdrops

There are nine, and this is all of them. Nothing here is a kitchen, an office, a meeting room, a street, or a workshop. Pick for tone and for how much detail you can afford behind the balloons, never for what the scene is nominally about. A conversation about databases works fine in a field.

Omitting `background` leaves the panel plain white. That is the right call for a scene the set genuinely cannot place, and it is worth one panel where you want the frame to go quiet. It is not a default. A strip with no backdrop anywhere reads as unfinished art, so choose one that fits the mood and hold it.

Every character except `buck`, `kirby`, and `veronica` is black-and-white line art, so the backdrop decides whether a panel is monochrome. Three backdrops are ink; the other six are colour. Colour behind a monochrome character is normal and reads fine, it is just louder, and a whole strip that stays in one register looks more deliberate than one that mixes.

### Monochrome, pen and ink

These three match the cast's own line work. A strip built from these plus blank panels is fully black-and-white.

| backdrop | look | use |
| --- | --- | --- |
| field | a bare grassy hill, a giant ribbed urn at the left edge, a hedge ridge behind, dense hatched sky | outdoors, journeys, anything that wants space. The cleanest ink option and the safest of the three |
| pastoral | a dense garden of trees and shrubs with a stepped footbridge cutting through, hatched throughout | lush, overgrown, complicated. Very textured, so keep the cast large and the balloons short |
| room | a still interior with one huge arched window onto rolling hills, a tall cactus at the right, hatched walls and floor | stillness, strangeness, waiting. Reads dreamlike and slightly empty. It is not a kitchen and not an office |

### Colour

| backdrop | look | use |
| --- | --- | --- |
| buckroom | a kid's bedroom in flat cartoon colour: grey walls, green carpet, shelves crowded with models and toys, a TV on a desk, a pink dresser with a lamp, a beanbag, a toy chest, a bat against the wall | childhood, hobbies, home. The busiest thing in the set, and small characters get lost in it |
| clouds | soft airbrushed blue sky with white cloud banks, nothing else in frame | calm, relief, optimism, a daydream. Empty enough to be the safest colour choice |
| den | pastel living room: mint walls, a purple wing chair, a low table with pots, a framed picture, a tall arched opening onto a sunset landscape | quiet conversation, a comfortable interior. The left half is clear, so characters read well |
| space | purple starfield with cratered planets and two small rockets over a pink rocky plain | scale, ambition, science fiction, absurd distance |
| volcano | watercolour: a pink peak over a blue ridge and flat water, olive sky, no detail | looming trouble, awe, a turning point. Soft and nearly empty, so characters sit clean against it |
| yellow | flat chartreuse, a single bright colour field | punchlines and pull quotes. No depth at all, maximum contrast on the balloons |
