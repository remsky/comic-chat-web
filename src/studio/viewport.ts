// Pane split dragging and strip zoom: the slider, Ctrl+wheel, and touch pinch share one card size.

const SPLIT_X_KEY = "comic-chat.studio-split-x";
const SPLIT_Y_KEY = "comic-chat.studio-split-y";
const WHEEL_ZOOM_RATE = 0.0022;

// matches the studio.css breakpoint that stacks the panes
const stacked = window.matchMedia("(width < 62rem)");

export function wireSplit(app: HTMLElement, divider: HTMLElement): void {
	const applyX = (width: number): number => {
		const max = app.getBoundingClientRect().width * 0.65;
		const clamped = Math.round(Math.min(Math.max(width, 256), max));
		app.style.setProperty("--split-x", `${clamped}px`);
		return clamped;
	};
	const applyY = (height: number): number => {
		const max = app.getBoundingClientRect().height * 0.8;
		const clamped = Math.round(Math.min(Math.max(height, 128), max));
		app.style.setProperty("--split-y", `${clamped}px`);
		return clamped;
	};
	const restore = (key: string, apply: (value: number) => number): void => {
		const stored = Number(localStorage.getItem(key));
		if (Number.isFinite(stored) && stored > 0) apply(stored);
	};
	restore(SPLIT_X_KEY, applyX);
	restore(SPLIT_Y_KEY, applyY);

	divider.addEventListener("pointerdown", (event) => {
		event.preventDefault();
		divider.setPointerCapture(event.pointerId);
		let value = 0;
		const move = (ev: PointerEvent): void => {
			const bounds = app.getBoundingClientRect();
			value = stacked.matches
				? applyY(ev.clientY - bounds.top)
				: applyX(bounds.right - ev.clientX);
		};
		const finish = (): void => {
			divider.removeEventListener("pointermove", move);
			divider.removeEventListener("pointerup", finish);
			divider.removeEventListener("pointercancel", finish);
			if (value > 0)
				localStorage.setItem(
					stacked.matches ? SPLIT_Y_KEY : SPLIT_X_KEY,
					String(value),
				);
		};
		divider.addEventListener("pointermove", move);
		divider.addEventListener("pointerup", finish);
		divider.addEventListener("pointercancel", finish);
	});
	divider.addEventListener("dblclick", () => {
		app.style.removeProperty("--split-x");
		app.style.removeProperty("--split-y");
		localStorage.removeItem(SPLIT_X_KEY);
		localStorage.removeItem(SPLIT_Y_KEY);
	});
}

export interface ZoomOptions {
	// the scrolling pane, which takes the gestures
	stage: HTMLElement;
	// the grid that reads --card
	panels: HTMLElement;
	slider: HTMLInputElement;
	columns: () => number;
}

export interface ZoomControl {
	// size the tiles so one row of columns fills the pane
	fit: () => void;
}

export function wireZoom({
	stage,
	panels,
	slider,
	columns,
}: ZoomOptions): ZoomControl {
	const min = Number(slider.min);
	const max = Number(slider.max);
	let current = Number(slider.value);

	// keeps the content under the focal point still while everything scales around it
	const apply = (next: number, focalX: number, focalY: number): void => {
		const clamped = Math.round(Math.min(Math.max(next, min), max));
		if (clamped === current) return;
		const ratio = clamped / current;
		current = clamped;
		slider.value = String(clamped);
		panels.style.setProperty("--card", `${clamped}px`);
		const rect = stage.getBoundingClientRect();
		const x = focalX - rect.left;
		const y = focalY - rect.top;
		stage.scrollLeft = (stage.scrollLeft + x) * ratio - x;
		stage.scrollTop = (stage.scrollTop + y) * ratio - y;
	};

	const centre = (): [number, number] => {
		const rect = stage.getBoundingClientRect();
		return [rect.left + rect.width / 2, rect.top + rect.height / 2];
	};

	slider.addEventListener("input", () => {
		apply(Number(slider.value), ...centre());
	});

	// trackpad pinches arrive as ctrl-modified wheel events
	stage.addEventListener(
		"wheel",
		(event) => {
			if (!event.ctrlKey && !event.metaKey) return;
			event.preventDefault();
			apply(
				current * Math.exp(-event.deltaY * WHEEL_ZOOM_RATE),
				event.clientX,
				event.clientY,
			);
		},
		{ passive: false },
	);

	const span = (touches: TouchList): number => {
		const a = touches.item(0);
		const b = touches.item(1);
		if (!a || !b) return 0;
		return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
	};
	let pinch = 0;
	stage.addEventListener(
		"touchstart",
		(event) => {
			if (event.touches.length === 2) pinch = span(event.touches);
		},
		{ passive: true },
	);
	stage.addEventListener(
		"touchmove",
		(event) => {
			if (pinch === 0 || event.touches.length !== 2) return;
			if (event.cancelable) event.preventDefault();
			const next = span(event.touches);
			const a = event.touches.item(0);
			const b = event.touches.item(1);
			if (next === 0 || !a || !b) return;
			apply(
				current * (next / pinch),
				(a.clientX + b.clientX) / 2,
				(a.clientY + b.clientY) / 2,
			);
			pinch = next;
		},
		{ passive: false },
	);
	const release = (): void => {
		pinch = 0;
	};
	stage.addEventListener("touchend", release);
	stage.addEventListener("touchcancel", release);

	return {
		fit: () => {
			const styles = getComputedStyle(panels);
			const cols = Math.max(1, columns());
			const width =
				stage.clientWidth -
				Number.parseFloat(styles.paddingLeft) -
				Number.parseFloat(styles.paddingRight) -
				Number.parseFloat(styles.columnGap) * (cols - 1);
			apply(width / cols, ...centre());
		},
	};
}
