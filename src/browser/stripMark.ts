// The credit line every exported sheet carries, drawn into the band under the last panel row.

const MARK_COLOR = "#333";
const MARK_FAMILY = '"Segoe UI", system-ui, sans-serif';
// a one-column sheet is the reference; wider sheets scale by the square root, enough to stay legible without taking over
const MARK_BASE_WIDTH = 700;
const MARK_FONT_PX = 12;

// the host comes off the page, so a fork's exports name the fork
export function stripMarkParts(host: string): { left: string; right: string } {
	return {
		left: "Engine ported from Comic Chat 1996 · characters by Jim Woodring",
		right: host,
	};
}

function markFont(width: number): number {
	const scale = Math.max(1, Math.sqrt(width / MARK_BASE_WIDTH));
	return Math.round(MARK_FONT_PX * scale);
}

// the band gives the type twice its own height; a small sheet already has that much gutter
function markBand(width: number, gap: number): number {
	return Math.max(gap, markFont(width) * 2);
}

// extra sheet height the band needs beyond the gutter under the last row
export function stripMarkGrowth(width: number, gap: number): number {
	return markBand(width, gap) - gap;
}

export function drawStripMark(
	context: CanvasRenderingContext2D,
	width: number,
	height: number,
	gap: number,
	host: string = location.host,
): void {
	const { left, right } = stripMarkParts(host);
	// whole pixels, so "middle" never lands the glyphs on a subpixel boundary
	const y = height - Math.round(markBand(width, gap) / 2);
	context.save();
	context.font = `${markFont(width)}px ${MARK_FAMILY}`;
	context.fillStyle = MARK_COLOR;
	context.textBaseline = "middle";
	// the gutter on both sides, so each end sits flush with the panel column
	context.textAlign = "left";
	context.fillText(left, gap, y);
	context.textAlign = "right";
	context.fillText(right, width - gap, y);
	context.restore();
}
