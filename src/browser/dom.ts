// Small DOM helpers shared across the room shell.

export function element<T extends HTMLElement>(id: string): T {
	const found = document.getElementById(id);
	if (!found) throw new Error(`room shell is missing #${id}`);
	return found as T;
}

export function displayName(name: string): string {
	return name.charAt(0).toUpperCase() + name.slice(1);
}

// how far a scroller must move to bring an item into view, matching scrollIntoView's "nearest"
export function scrollDelta(
	viewTop: number,
	viewBottom: number,
	itemTop: number,
	itemBottom: number,
): number {
	if (itemTop < viewTop) return itemTop - viewTop;
	if (itemBottom > viewBottom)
		return Math.min(itemBottom - viewBottom, itemTop - viewTop);
	return 0;
}

// scrollIntoView walks every scrollable ancestor, which yanks the page around; this moves one scroller
export function revealWithin(scroller: HTMLElement, target: HTMLElement): void {
	const view = scroller.getBoundingClientRect();
	const item = target.getBoundingClientRect();
	const delta = scrollDelta(view.top, view.bottom, item.top, item.bottom);
	if (delta !== 0) scroller.scrollTop += delta;
}

export function nearBottom(scroller: HTMLElement): boolean {
	return (
		scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 24
	);
}

export function checkRadios(container: HTMLElement, value: string): void {
	for (const radio of container.querySelectorAll<HTMLInputElement>("input"))
		radio.checked = radio.value === value;
}
