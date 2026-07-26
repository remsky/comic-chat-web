// Server-side profanity screen. Lives in worker/ so the wordlist never ships to the browser.

import {
	englishDataset,
	englishRecommendedTransformers,
	RegExpMatcher,
} from "obscenity";

// recommended transformers fold leetspeak and accents, so "4rse" still matches; spacing is not folded
const matcher = new RegExpMatcher({
	...englishDataset.build(),
	...englishRecommendedTransformers,
});

export function isProhibited(text: string): boolean {
	return matcher.hasMatch(text);
}

// on unless a self-hosted deploy sets MODERATION=off, so a fresh clone still screens
export function screeningEnabled(env: { MODERATION?: string }): boolean {
	return env.MODERATION !== "off";
}
