// App shell layout: viewport pinning, the mobile sheet, and the sidebar divider.

import { element } from "./dom.js";
import { SIDEBAR_WIDTH_KEY } from "./storage.js";

// pin the app to the visible viewport so the iOS keyboard slides over nothing but the composer
export function trackVisibleViewport(): void {
	const viewport = window.visualViewport;
	if (!viewport) return;
	const footer = document.querySelector<HTMLElement>(".legal-footer");
	const titlebar = document.querySelector<HTMLElement>(".titlebar");
	const apply = () => {
		document.documentElement.style.setProperty(
			"--app-height",
			`${viewport.height}px`,
		);
		// reserve room in the join dialog's scroll area so it can never grow over the fixed footer beneath it
		if (footer)
			document.documentElement.style.setProperty(
				"--footer-height",
				`${footer.offsetHeight}px`,
			);
		// the join tagline pins itself just below the measured header
		if (titlebar)
			document.documentElement.style.setProperty(
				"--titlebar-height",
				`${titlebar.offsetHeight}px`,
			);
		// follow any iOS scroll offset so the pinned app stays glued to the visible area
		document.body.style.transform = `translateY(${viewport.offsetTop}px)`;
	};
	viewport.addEventListener("resize", apply);
	viewport.addEventListener("scroll", apply);
	apply();
}

// on phones the sidebar moves into a tap-open sheet above the send bar, one section at a time
export function wireMobilePanels(): void {
	const sidebar = document.querySelector<HTMLElement>(".sidebar");
	const toolbar = document.querySelector<HTMLElement>(".mobile-toolbar");
	const sheet = element("mobile-sheet");
	const workspace = element("room");
	if (!sidebar || !toolbar) return;
	const buttons = [
		...toolbar.querySelectorAll<HTMLButtonElement>(".toolbar-button"),
	];
	const mobile = window.matchMedia("(max-width: 760px)");

	const closePanel = () => {
		sheet.hidden = true;
		sheet.removeAttribute("data-panel");
		for (const button of buttons) button.setAttribute("aria-expanded", "false");
	};

	const openPanel = (panel: string, active: HTMLButtonElement) => {
		sheet.dataset.panel = panel;
		sheet.hidden = false;
		for (const button of buttons)
			button.setAttribute("aria-expanded", String(button === active));
	};

	// desktop shows the sidebar inline; mobile parks it in the sheet
	const placeSidebar = () => {
		const host = mobile.matches ? sheet : workspace;
		if (sidebar.parentElement !== host) host.append(sidebar);
		if (!mobile.matches) closePanel();
	};

	for (const button of buttons) {
		button.addEventListener("click", () => {
			const panel = button.dataset.panel ?? "";
			if (!sheet.hidden && sheet.dataset.panel === panel) closePanel();
			else openPanel(panel, button);
		});
	}

	// dismiss the sheet on a tap outside it (but not on the wheel/roster inside)
	document.addEventListener("pointerdown", (event) => {
		if (sheet.hidden) return;
		const target = event.target;
		if (
			target instanceof Node &&
			(sheet.contains(target) || toolbar.contains(target))
		)
			return;
		closePanel();
	});
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && !sheet.hidden) closePanel();
	});

	mobile.addEventListener("change", placeSidebar);
	placeSidebar();
}

// desktop only: drag the divider to trade strip space for sidebar space
export function wireSidebarResize(): void {
	const resizer = element("sidebar-resizer");
	const sidebar = document.querySelector<HTMLElement>(".sidebar");
	if (!sidebar) return;
	const apply = (width: number): number => {
		const max = Math.min(640, window.innerWidth * 0.6);
		const clamped = Math.round(Math.min(Math.max(width, 176), max));
		sidebar.style.setProperty("--sidebar-width", `${clamped}px`);
		return clamped;
	};
	const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
	if (Number.isFinite(stored) && stored > 0) apply(stored);
	resizer.addEventListener("pointerdown", (event) => {
		event.preventDefault();
		resizer.setPointerCapture(event.pointerId);
		let width = sidebar.getBoundingClientRect().width;
		const move = (ev: PointerEvent): void => {
			width = apply(sidebar.getBoundingClientRect().right - ev.clientX);
		};
		const finish = (): void => {
			resizer.removeEventListener("pointermove", move);
			resizer.removeEventListener("pointerup", finish);
			resizer.removeEventListener("pointercancel", finish);
			localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
		};
		resizer.addEventListener("pointermove", move);
		resizer.addEventListener("pointerup", finish);
		resizer.addEventListener("pointercancel", finish);
	});
	resizer.addEventListener("dblclick", () => {
		sidebar.style.removeProperty("--sidebar-width");
		localStorage.removeItem(SIDEBAR_WIDTH_KEY);
	});
}
