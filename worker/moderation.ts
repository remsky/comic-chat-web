// Server-side profanity screen. Lives in worker/ so the wordlist never ships to the browser.

import {
	englishDataset,
	englishRecommendedTransformers,
	RegExpMatcher,
} from "obscenity";

// recommended transformers fold leetspeak and spacing so "n1gg3r" and "f u c k" still match
const matcher = new RegExpMatcher({
	...englishDataset.build(),
	...englishRecommendedTransformers,
});

export function isProhibited(text: string): boolean {
	return matcher.hasMatch(text);
}
