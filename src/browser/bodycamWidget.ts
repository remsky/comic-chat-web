// Browser CBodyCam: the self-view pane with the emotion wheel (bodycam.cpp).

import {
	AF_FROZEN,
	AF_TEMPFROZEN,
	AF_UNFROZEN,
	type Avatar,
	cloneBody,
} from "../engine/avatar.js";
import {
	BodyCamModel,
	CURSOR_RADIUS,
	cacheBullSide,
	EMOTION_NAMES,
	emotionIsStatus,
	getEmotionFromPoint,
	getIconRect,
	ICON_HEIGHT,
	ICON_WIDTH,
	iconHitTest,
	NEMOTIONS,
	stringFromEmotion,
	WHEEL_ICON_FILES,
} from "../engine/bodycam.js";
import type { Point } from "../engine/vector2d.js";
import type { AvatarAtlasCache } from "./avatarAssets.js";
import { bodySpriteLayers, drawSpriteLayer } from "./canvasRenderer.js";

// height of the body-feedback area above the wheel; the original pane was splitter-sized
const PREVIEW_HEIGHT = 130;

export interface BodyCamWidgetOptions {
	canvas: HTMLCanvasElement;
	lockButton: HTMLButtonElement;
	sendButton: HTMLButtonElement;
	atlases: AvatarAtlasCache;
	getAvatar: () => Avatar | undefined;
	setStatus: (text: string | null) => void;
	sendExpression: () => void;
	forwardTyping: (key: string) => void;
}

export class BodyCamWidget {
	private readonly model = new BodyCamModel();
	private readonly icons: HTMLImageElement[] = [];
	private mouseDown = false;
	private lastEmotionName: string | null = null;
	// mirror of my avatar's m_freeze so it survives composition rebuilds
	private freeze = AF_UNFROZEN;
	private width = 0;
	private height = 0;
	private menu: HTMLElement | null = null;

	constructor(private readonly options: BodyCamWidgetOptions) {
		const { canvas } = options;
		for (const name of WHEEL_ICON_FILES) {
			const image = new Image(ICON_WIDTH, ICON_HEIGHT);
			image.src = `/assets/wheel/${name}.png`;
			image.decode().then(
				() => this.draw(),
				() => {},
			);
			this.icons.push(image);
		}
		canvas.addEventListener("pointerdown", (event) => {
			if (event.button !== 0) return;
			this.onPointerDown(event);
		});
		canvas.addEventListener("pointermove", (event) =>
			this.onPointerMove(event),
		);
		canvas.addEventListener("pointerup", (event) => this.onPointerUp(event));
		canvas.addEventListener("contextmenu", (event) => {
			event.preventDefault();
			this.openMenu(event.clientX, event.clientY);
		});
		options.lockButton.addEventListener("click", () => this.toggleFreeze());
		options.sendButton.addEventListener("click", () =>
			options.sendExpression(),
		);
		this.syncFreeze();
		canvas.addEventListener("keydown", (event) => this.onKeyDown(event));
		new ResizeObserver(() => this.layout()).observe(canvas);
		this.layout();
	}

	// OnSize: the client width drives the bull side; wheel square sits at the bottom
	private layout(): void {
		const { canvas } = this.options;
		const width = Math.trunc(canvas.clientWidth);
		if (width <= 0) return;
		const height = PREVIEW_HEIGHT + cacheBullSide(width).bullSide;
		this.width = width;
		this.height = height;
		this.model.setRect({ left: 0, top: 0, right: width, bottom: height });
		const ratio = window.devicePixelRatio || 1;
		canvas.width = Math.round(width * ratio);
		canvas.height = Math.round(height * ratio);
		canvas.style.height = `${height}px`;
		this.draw();
	}

	private pointFrom(event: PointerEvent): Point {
		return { x: Math.trunc(event.offsetX), y: Math.trunc(event.offsetY) };
	}

	// CBodyCam::OnLButtonDown (bodycam.cpp:271-292)
	private onPointerDown(event: PointerEvent): void {
		const { canvas } = this.options;
		canvas.focus();
		if (this.model.bullDisabled) return;
		this.mouseDown = true;
		canvas.setPointerCapture(event.pointerId);
		this.applyPoint(this.pointFrom(event));
		const avatar = this.options.getAvatar();
		if (avatar && avatar.freeze === AF_UNFROZEN) {
			avatar.freeze = AF_TEMPFROZEN;
			this.freeze = AF_TEMPFROZEN;
		}
	}

	private onPointerMove(event: PointerEvent): void {
		if (this.mouseDown) {
			this.applyPoint(this.pointFrom(event));
			return;
		}
		// OnToolHitTest tooltip: name the emotion icon under the pointer
		const hit = iconHitTest(this.pointFrom(event), this.model.layout);
		this.options.canvas.title = hit >= 0 ? (EMOTION_NAMES[hit] ?? "") : "";
	}

	// CBodyCam::OnLButtonUp resets the status pane (bodycam.cpp:305-314)
	private onPointerUp(event: PointerEvent): void {
		if (!this.mouseDown) return;
		this.mouseDown = false;
		this.options.canvas.releasePointerCapture(event.pointerId);
		this.lastEmotionName = null;
		this.options.setStatus(null);
	}

	private toggleFreeze(): void {
		const avatar = this.options.getAvatar();
		if (!avatar) return;
		avatar.freeze = avatar.freeze === AF_FROZEN ? AF_UNFROZEN : AF_FROZEN;
		this.freeze = avatar.freeze;
		this.syncFreeze();
		this.draw();
	}

	// mirror the lock state onto the corner button
	private syncFreeze(): void {
		const frozen = this.freeze === AF_FROZEN;
		const { lockButton } = this.options;
		lockButton.textContent = frozen ? "\u{1F512}" : "\u{1F513}";
		lockButton.title = frozen ? "Unfreeze expression" : "Freeze expression";
		lockButton.setAttribute("aria-pressed", String(frozen));
		lockButton.classList.toggle("bodycam-lock-active", frozen);
	}

	// UpdateEmotion: pose the avatar and narrate only when the cursor pixel moved
	private applyPoint(point: Point): void {
		const emotion = getEmotionFromPoint(point, this.model.layout);
		if (!this.model.updateEmotion(emotion)) return;
		const avatar = this.options.getAvatar();
		avatar?.updateBody(
			avatar.getBodyFromEmotion(emotion.emotion, emotion.intensity),
		);
		if (this.mouseDown) {
			const name = stringFromEmotion(emotion);
			if (name !== this.lastEmotionName) {
				this.options.setStatus(emotionIsStatus(name));
				this.lastEmotionName = name;
			}
		}
		this.draw();
	}

	// CBodyCam::OnChar forwards typing to the say window (bodycam.cpp:608-623)
	private onKeyDown(event: KeyboardEvent): void {
		if (
			event.key.length !== 1 ||
			event.ctrlKey ||
			event.metaKey ||
			event.altKey
		)
			return;
		event.preventDefault();
		this.options.forwardTyping(event.key);
	}

	// IDR_BODYCONTEXT menu: Freeze toggle + Send Expression (bodycam.cpp:758-814)
	private openMenu(x: number, y: number): void {
		this.closeMenu();
		const avatar = this.options.getAvatar();
		const menu = document.createElement("menu");
		menu.className = "bodycam-menu";
		menu.style.left = `${x}px`;
		menu.style.top = `${y}px`;
		const freeze = document.createElement("li");
		freeze.textContent = avatar?.freeze === AF_FROZEN ? "✓ Freeze" : "  Freeze";
		freeze.addEventListener("click", () => {
			this.closeMenu();
			this.toggleFreeze();
		});
		const send = document.createElement("li");
		send.textContent = "  Send Expression";
		send.addEventListener("click", () => {
			this.closeMenu();
			this.options.sendExpression();
		});
		menu.append(freeze, send);
		document.body.append(menu);
		this.menu = menu;
		const rect = menu.getBoundingClientRect();
		if (rect.right > window.innerWidth)
			menu.style.left = `${Math.max(0, window.innerWidth - rect.width)}px`;
		if (rect.bottom > window.innerHeight)
			menu.style.top = `${Math.max(0, window.innerHeight - rect.height)}px`;
		const dismiss = (event: Event) => {
			if (event.target instanceof Node && menu.contains(event.target)) return;
			this.closeMenu();
		};
		setTimeout(() => {
			document.addEventListener("pointerdown", dismiss, { once: true });
			document.addEventListener(
				"keydown",
				(event) => {
					if (event.key === "Escape") this.closeMenu();
				},
				{ once: true },
			);
		});
	}

	private closeMenu(): void {
		this.menu?.remove();
		this.menu = null;
	}

	// RefreshBodyCam after a message lands: resync the freeze mirror and repaint
	refresh(): void {
		const avatar = this.options.getAvatar();
		if (avatar) this.freeze = avatar.freeze;
		this.syncFreeze();
		this.draw();
	}

	// reapply widget state to the fresh avatar objects after a composition rebuild
	restore(): void {
		const avatar = this.options.getAvatar();
		if (!avatar) return;
		avatar.freeze = this.freeze;
		if (this.freeze !== AF_UNFROZEN)
			avatar.updateBody(
				avatar.getBodyFromEmotion(
					this.model.emotion.emotion,
					this.model.emotion.intensity,
				),
			);
		this.syncFreeze();
		this.draw();
	}

	// CBodyCam::OnPaint (bodycam.cpp:137-182)
	draw(): void {
		const { canvas } = this.options;
		const context = canvas.getContext("2d");
		if (!context || this.width <= 0) return;
		const ratio = window.devicePixelRatio || 1;
		context.save();
		context.scale(ratio, ratio);
		context.fillStyle = "#fff";
		context.fillRect(0, 0, this.width, this.height);
		this.drawBullsEye(context);
		if (!this.model.bullDisabled) {
			this.drawIcons(context);
			this.drawCursor(context);
		}
		this.drawBody(context);
		if (this.freeze === AF_FROZEN) this.drawFrozenFrame(context);
		context.restore();
	}

	// lock indicator: navy frame only while explicitly frozen
	private drawFrozenFrame(context: CanvasRenderingContext2D): void {
		context.strokeStyle = "#000080";
		context.lineWidth = 2;
		context.strokeRect(1, 1, this.width - 2, this.height - 2);
	}

	// DrawBullsEye: gray widget strip, white circle, plus-sign center (bodycam.cpp:196-213)
	private drawBullsEye(context: CanvasRenderingContext2D): void {
		const { bullsEye, circleRadius } = this.model.layout;
		const side = this.model.bullSide;
		context.fillStyle = "rgb(210, 210, 210)";
		context.fillRect(0, this.height - side, this.width, side);
		if (this.model.bullDisabled) return;
		context.fillStyle = "#fff";
		context.strokeStyle = "#000";
		context.lineWidth = 1;
		context.beginPath();
		context.ellipse(
			bullsEye.x,
			bullsEye.y,
			circleRadius,
			circleRadius,
			0,
			0,
			2 * Math.PI,
		);
		context.fill();
		context.stroke();
		// DrawPoint's plus sign, delta 5 (panel.cpp:56-62)
		context.beginPath();
		context.moveTo(bullsEye.x + 0.5, bullsEye.y - 5);
		context.lineTo(bullsEye.x + 0.5, bullsEye.y + 5);
		context.moveTo(bullsEye.x - 5, bullsEye.y + 0.5);
		context.lineTo(bullsEye.x + 5, bullsEye.y + 0.5);
		context.stroke();
	}

	// DrawBullsEyeCons: icons draw from the flipped rect's (left, bottom) corner
	private drawIcons(context: CanvasRenderingContext2D): void {
		for (let i = 0; i < NEMOTIONS; i++) {
			const icon = this.icons[i];
			if (!icon?.complete || icon.naturalWidth === 0) continue;
			const rect = getIconRect(i, this.model.layout);
			context.drawImage(icon, rect.left, rect.bottom, ICON_WIDTH, ICON_HEIGHT);
		}
	}

	// the R2_XORPEN drag dot, approximated with a difference-composited disc
	private drawCursor(context: CanvasRenderingContext2D): void {
		const position = this.model.cursorPos;
		context.save();
		context.globalCompositeOperation = "difference";
		context.fillStyle = "#fff";
		context.beginPath();
		context.ellipse(
			position.x,
			position.y,
			CURSOR_RADIUS,
			CURSOR_RADIUS,
			0,
			0,
			2 * Math.PI,
		);
		context.fill();
		context.restore();
	}

	// CBodyCam::DrawBody: height-fit the body above the wheel (bodycam.cpp:396-428)
	private drawBody(context: CanvasRenderingContext2D): void {
		const avatar = this.options.getAvatar();
		if (!avatar?.body) return;
		const bodyHeight = this.height - this.model.bullSide;
		if (bodyHeight <= 0) return;
		const body = cloneBody(avatar.body);
		// rect2 widens by ±1000 so the body keeps a fixed height, clipped to width
		body.bbox = {
			left: -1000,
			right: this.width + 1000,
			top: 0,
			bottom: -bodyHeight,
		};
		context.save();
		context.beginPath();
		context.rect(0, 0, this.width, bodyHeight);
		context.clip();
		for (const layer of bodySpriteLayers(avatar, body))
			drawSpriteLayer(context, this.options.atlases, layer);
		context.restore();
	}
}
