export interface CanvasSurfaceOptions {
	maxDevicePixelRatio?: number;
	requestFrame?: (callback: FrameRequestCallback) => number;
	cancelFrame?: (handle: number) => void;
	createObserver?: (callback: ResizeObserverCallback) => ResizeObserver;
	getDevicePixelRatio?: () => number;
}

export interface BackingStoreSize {
	width: number;
	height: number;
	dpr: number;
}

export function canvasBackingStoreSize(
	cssWidth: number,
	cssHeight: number,
	devicePixelRatio: number,
	maxDevicePixelRatio = 2,
): BackingStoreSize {
	const dpr = Math.max(1, Math.min(devicePixelRatio, maxDevicePixelRatio));
	return {
		width: Math.max(1, Math.round(cssWidth * dpr)),
		height: Math.max(1, Math.round(cssHeight * dpr)),
		dpr,
	};
}

export class CanvasSurface {
	readonly canvas: HTMLCanvasElement;
	readonly context: CanvasRenderingContext2D;
	readonly logicalWidth: number;
	readonly logicalHeight: number;
	readonly ready: Promise<void>;
	private readonly draw: () => void;
	private readonly options: Required<CanvasSurfaceOptions>;
	private readonly observer: ResizeObserver;
	private frame = 0;
	private disposed = false;
	private resolveReady: () => void = () => {};
	private dprQuery: MediaQueryList | null = null;
	private readonly onDprChange = (): void => {
		this.watchDevicePixelRatio();
		const rect = this.canvas.getBoundingClientRect();
		this.resize(rect.width, rect.height);
	};

	constructor(
		canvas: HTMLCanvasElement,
		logicalWidth: number,
		logicalHeight: number,
		draw: (context: CanvasRenderingContext2D) => void,
		options: CanvasSurfaceOptions = {},
	) {
		// alpha stays on so a freshly sized backing store shows the page background, never opaque black
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Canvas 2D rendering is unavailable");
		this.canvas = canvas;
		this.context = context;
		this.logicalWidth = logicalWidth;
		this.logicalHeight = logicalHeight;
		this.ready = new Promise((resolve) => {
			this.resolveReady = resolve;
		});
		this.draw = () => {
			draw(context);
			this.resolveReady();
		};
		this.options = {
			maxDevicePixelRatio: options.maxDevicePixelRatio ?? 2,
			requestFrame:
				options.requestFrame ?? ((callback) => requestAnimationFrame(callback)),
			cancelFrame:
				options.cancelFrame ?? ((handle) => cancelAnimationFrame(handle)),
			createObserver:
				options.createObserver ?? ((callback) => new ResizeObserver(callback)),
			getDevicePixelRatio:
				options.getDevicePixelRatio ?? (() => window.devicePixelRatio || 1),
		};
		canvas.style.aspectRatio = `${logicalWidth} / ${logicalHeight}`;
		canvas.style.width = "100%";
		canvas.style.height = "auto";
		this.observer = this.options.createObserver((entries) => {
			const entry = entries[0];
			if (!entry) return;
			this.resize(entry.contentRect.width, entry.contentRect.height);
		});
		this.observer.observe(canvas);
		this.watchDevicePixelRatio();
	}

	// monitor moves between screens never fire the ResizeObserver, so track DPR via matchMedia
	private watchDevicePixelRatio(): void {
		if (typeof matchMedia !== "function") return;
		this.dprQuery?.removeEventListener("change", this.onDprChange);
		this.dprQuery = matchMedia(
			`(resolution: ${this.options.getDevicePixelRatio()}dppx)`,
		);
		this.dprQuery.addEventListener("change", this.onDprChange);
	}

	resize(cssWidth: number, cssHeight: number): void {
		if (this.disposed || cssWidth <= 0 || cssHeight <= 0) return;
		const size = canvasBackingStoreSize(
			cssWidth,
			cssHeight,
			this.options.getDevicePixelRatio(),
			this.options.maxDevicePixelRatio,
		);
		const changed =
			this.canvas.width !== size.width || this.canvas.height !== size.height;
		if (this.canvas.width !== size.width) this.canvas.width = size.width;
		if (this.canvas.height !== size.height) this.canvas.height = size.height;
		// sizing clears the bitmap, so repaint in the same frame instead of flashing until the next one
		if (changed) this.drawNow();
		else this.invalidate();
	}

	invalidate(): void {
		if (this.disposed || this.frame !== 0) return;
		this.frame = this.options.requestFrame(() => {
			this.frame = 0;
			this.drawNow();
		});
	}

	private drawNow(): void {
		this.context.setTransform(
			this.canvas.width / this.logicalWidth,
			0,
			0,
			this.canvas.height / this.logicalHeight,
			0,
			0,
		);
		this.draw();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.observer.disconnect();
		this.dprQuery?.removeEventListener("change", this.onDprChange);
		if (this.frame !== 0) this.options.cancelFrame(this.frame);
		this.frame = 0;
		this.resolveReady();
	}
}
