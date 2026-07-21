// Small DOM helpers shared across the room shell.

export function element<T extends HTMLElement>(id: string): T {
	const found = document.getElementById(id);
	if (!found) throw new Error(`room shell is missing #${id}`);
	return found as T;
}

export function displayName(name: string): string {
	return name.charAt(0).toUpperCase() + name.slice(1);
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
