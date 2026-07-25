// Pointer-driven list reordering, shared by the strip and the constructor.

const DRAG_SLOP = 4;

export function moveItem<T>(items: T[], from: number, to: number): void {
	if (from === to || from < 0 || from >= items.length) return;
	const [moved] = items.splice(from, 1);
	if (moved === undefined) return;
	items.splice(Math.max(0, Math.min(to, items.length)), 0, moved);
}

export interface Point {
	x: number;
	y: number;
}

// nearest centre works for a column and a grid alike, so both lists drop the same way
export function nearestIndex(
	centres: readonly Point[],
	x: number,
	y: number,
): number {
	let best = -1;
	let bestDistance = Number.POSITIVE_INFINITY;
	centres.forEach((centre, index) => {
		const distance = (centre.x - x) ** 2 + (centre.y - y) ** 2;
		if (distance < bestDistance) {
			bestDistance = distance;
			best = index;
		}
	});
	return best;
}

export interface ReorderOptions {
	container: HTMLElement;
	// the item a pointerdown landed in, or null to let the event through untouched
	itemFor: (target: HTMLElement) => HTMLElement | null;
	// touch drags only make sense off a dedicated grip; elsewhere the finger has to scroll
	touch?: boolean;
	onMove: (from: number, to: number) => void;
}

export function attachReorder(options: ReorderOptions): void {
	const { container } = options;
	let source: HTMLElement | null = null;
	let items: HTMLElement[] = [];
	let centres: Point[] = [];
	let from = -1;
	let to = -1;
	let startX = 0;
	let startY = 0;
	let dragging = false;

	function mark(index: number): void {
		items.forEach((item, i) => {
			item.classList.toggle("is-drop", i === index && i !== from);
		});
	}

	function end(): void {
		window.removeEventListener("pointermove", onMove);
		window.removeEventListener("pointerup", onUp);
		window.removeEventListener("pointercancel", onUp);
		source?.classList.remove("is-dragging");
		mark(-1);
		source = null;
		items = [];
		centres = [];
	}

	function onMove(event: PointerEvent): void {
		if (!source) return;
		if (
			!dragging &&
			Math.abs(event.clientX - startX) + Math.abs(event.clientY - startY) <
				DRAG_SLOP
		)
			return;
		if (!dragging) {
			dragging = true;
			source.classList.add("is-dragging");
		}
		event.preventDefault();
		to = nearestIndex(centres, event.clientX, event.clientY);
		mark(to);
	}

	function onUp(): void {
		const moved = dragging && to >= 0 && to !== from;
		const moveFrom = from;
		const moveTo = to;
		end();
		if (!moved) return;
		// the drag ends in a click on whatever is under the pointer; that click is not a selection
		window.addEventListener(
			"click",
			(event) => {
				event.preventDefault();
				event.stopPropagation();
			},
			{ capture: true, once: true },
		);
		options.onMove(moveFrom, moveTo);
	}

	container.addEventListener("pointerdown", (event) => {
		if (event.button !== 0) return;
		if (event.pointerType === "touch" && !options.touch) return;
		const item = options.itemFor(event.target as HTMLElement);
		if (!item) return;
		items = [
			...container.querySelectorAll<HTMLElement>(":scope > [data-index]"),
		];
		from = items.indexOf(item);
		if (from < 0) return;
		centres = items.map((entry) => {
			const box = entry.getBoundingClientRect();
			return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
		});
		source = item;
		to = from;
		dragging = false;
		startX = event.clientX;
		startY = event.clientY;
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
		window.addEventListener("pointercancel", onUp);
	});
}
