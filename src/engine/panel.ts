// Pure panel composition helpers, starting with avatar camera geometry from panel.cpp.

import {
	type Avatar,
	type AvatarBody,
	type AvatarData,
	cloneBody,
} from "./avatar.js";
import { round } from "./vector2d.js";

export interface PlacedAvatar {
	avatar: Avatar;
	body: AvatarBody;
}

export interface AvatarLayoutOptions {
	unitWidth: number;
	unitHeight: number;
	establishing: boolean;
	zoomIn?: boolean;
}

export interface AvatarLayoutResult {
	zoomFactor: number;
	bodyWidth: number;
	margin: number;
}

export function bodyFromPoseIDs(
	data: AvatarData,
	facePoseID: number,
	torsoPoseID: number,
): AvatarBody {
	const common = {
		avatarID: data.avatarID,
		flip: false,
		requested: true,
		arrowX: 0,
		bbox: { left: -1, bottom: 0, right: -1, top: 0 },
	};
	if (data.type === "simple") {
		const bodyIndex = data.bodies.findIndex((rec) => rec.poseID === facePoseID);
		return {
			...common,
			kind: "simple",
			bodyIndex,
		};
	}
	const faceIndex = data.faces.findIndex((rec) => rec.poseID === facePoseID);
	const torsoIndex = data.torsos.findIndex((rec) => rec.poseID === torsoPoseID);
	return {
		...common,
		kind: "complex",
		faceIndex,
		torsoIndex,
	};
}

export function layoutAvatarGeometry(
	placed: readonly PlacedAvatar[],
	options: AvatarLayoutOptions,
): AvatarLayoutResult {
	const { unitWidth, unitHeight, establishing } = options;
	const zoomIn = options.zoomIn ?? true;
	const maxBodyHeight = Math.trunc(unitHeight / 1.9);
	const widths: number[] = [];
	const heights: number[] = [];
	const normHeights: number[] = [];
	const headHeights: number[] = [];
	const tops: number[] = [];
	const arrowFractions: number[] = [];
	let maxNorm = 0;

	for (let i = 0; i < placed.length; i++) {
		const entry = placed[i];
		if (!entry) continue;
		const dims = entry.avatar.getDimInfo(entry.body);
		widths[i] = dims.xdim;
		heights[i] = dims.ydim;
		normHeights[i] = dims.normHeight;
		headHeights[i] = dims.headHeight;
		arrowFractions[i] = dims.faceX / dims.xdim;
		maxNorm = Math.max(maxNorm, dims.normHeight);
	}

	let bodyWidth = 0;
	for (let i = 0; i < placed.length; i++) {
		const height = heights[i] ?? 0;
		const width = widths[i] ?? 0;
		const newHeight = round(
			maxBodyHeight * Math.fround((normHeights[i] ?? 0) / maxNorm),
		);
		const scaleRatio = Math.fround(newHeight / height);
		heights[i] = newHeight;
		widths[i] = round(Math.fround(scaleRatio * width));
		tops[i] = -unitHeight + newHeight;
		headHeights[i] = round(Math.fround(scaleRatio * (headHeights[i] ?? 0)));
		bodyWidth += widths[i] ?? 0;
	}

	let zoomFactor = 1.0;
	const sumWidth = bodyWidth;
	if (sumWidth > unitWidth) {
		const reduction = Math.fround(unitWidth / sumWidth);
		bodyWidth = 0;
		for (let i = 0; i < placed.length; i++) {
			heights[i] = round(Math.fround((heights[i] ?? 0) * reduction));
			widths[i] = round(Math.fround((widths[i] ?? 0) * reduction));
			tops[i] = -unitHeight + (heights[i] ?? 0);
			bodyWidth += widths[i] ?? 0;
		}
	} else if (zoomIn && !establishing) {
		zoomFactor = unitWidth / sumWidth;
		let maxHeadHeight = 0;
		for (const height of headHeights)
			maxHeadHeight = Math.max(maxHeadHeight, height);
		const headFactor = maxBodyHeight / (maxHeadHeight * 1.2);
		zoomFactor = Math.min(zoomFactor, headFactor);
		if (zoomFactor < 1.1) zoomFactor = 1.0;
		bodyWidth = 0;
		for (let i = 0; i < placed.length; i++) {
			heights[i] = round((heights[i] ?? 0) * zoomFactor);
			widths[i] = round((widths[i] ?? 0) * zoomFactor);
			bodyWidth += widths[i] ?? 0;
		}
	}

	const margin = Math.trunc((unitWidth - bodyWidth) / (placed.length + 1));
	let xOffset = margin;
	for (let i = 0; i < placed.length; i++) {
		const entry = placed[i];
		if (!entry) continue;
		const width = widths[i] ?? 0;
		const height = heights[i] ?? 0;
		const top = tops[i] ?? 0;
		entry.body.bbox = {
			left: xOffset,
			bottom: top - height,
			right: xOffset + width,
			top,
		};
		entry.body.arrowX =
			entry.body.bbox.left +
			round(
				(arrowFractions[i] ?? 0) *
					(entry.body.bbox.right - entry.body.bbox.left),
			);
		xOffset += width + margin;
	}

	return { zoomFactor, bodyWidth, margin };
}

export function clonePlacedAvatars(
	placed: readonly PlacedAvatar[],
): PlacedAvatar[] {
	return placed.map((entry) => ({
		avatar: entry.avatar,
		body: cloneBody(entry.body),
	}));
}
