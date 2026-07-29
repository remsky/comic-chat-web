// The panel painter lives in src/render so the worker can drive it; browser callers import it from here.

export {
	bodySpriteLayers,
	CanvasPanelRenderer,
	type CanvasPanelRendererOptions,
	drawSpriteLayer,
	type SpriteLayer,
} from "../render/panelRenderer.js";
