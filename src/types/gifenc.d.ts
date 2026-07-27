// Hand-written types for gifenc, which ships none.

declare module "gifenc" {
	export interface GifEncoder {
		writeFrame(
			index: Uint8Array,
			width: number,
			height: number,
			options?: {
				palette?: number[][];
				delay?: number;
				repeat?: number;
				transparent?: boolean;
				dispose?: number;
			},
		): void;
		finish(): void;
		bytes(): Uint8Array<ArrayBuffer>;
	}
	export function GIFEncoder(options?: { auto?: boolean }): GifEncoder;
	export function quantize(
		rgba: Uint8Array | Uint8ClampedArray,
		maxColors: number,
	): number[][];
	export function applyPalette(
		rgba: Uint8Array | Uint8ClampedArray,
		palette: number[][],
		format?: "rgb565" | "rgb444" | "rgba4444",
	): Uint8Array;
}
