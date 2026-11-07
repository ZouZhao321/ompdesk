export interface LayoutInput {
	id: string;
	parentId: string | null;
}

export interface LayoutCard {
	id: string;
	x: number;
	y: number;
}

export interface LayoutEdge {
	from: string;
	to: string;
}

export interface LayoutResult {
	cards: LayoutCard[];
	edges: LayoutEdge[];
	width: number;
	height: number;
}

export const CARD_WIDTH = 300;
export const CARD_HEIGHT = 132;
export const LANE_GAP = 44;
export const ROW_GAP = 34;

/**
 * Lays a turn tree out as lanes: the first child continues its parent's lane,
 * additional children open a new lane to the right, and each lane stacks
 * downward in reading order. Missing or cyclic parents become roots.
 */
export function layoutTurnTree(nodes: readonly LayoutInput[]): LayoutResult {
	const byId = new Map(nodes.map((node) => [node.id, node]));
	const children = new Map<string, string[]>();
	const roots: string[] = [];

	for (const node of nodes) {
		if (node.parentId && byId.has(node.parentId) && node.parentId !== node.id) {
			const list = children.get(node.parentId) ?? [];
			list.push(node.id);
			children.set(node.parentId, list);
		} else {
			roots.push(node.id);
		}
	}

	const cards: LayoutCard[] = [];
	const edges: LayoutEdge[] = [];
	const laneCursor = new Map<number, number>();
	const placed = new Set<string>();
	let nextLane = 0;

	// The branch that carries the most turns continues the trunk lane; short
	// dead ends open side lanes instead of pushing the main line sideways.
	const sizeMemo = new Map<string, number>();
	const sizeOf = (id: string, seen: Set<string>): number => {
		const memo = sizeMemo.get(id);
		if (memo !== undefined) return memo;
		if (seen.has(id)) return 0;
		seen.add(id);
		let size = 1;
		for (const kid of children.get(id) ?? []) size += sizeOf(kid, seen);
		sizeMemo.set(id, size);
		return size;
	};
	for (const kids of children.values()) {
		kids.sort((a, b) => sizeOf(b, new Set()) - sizeOf(a, new Set()));
	}

	const visit = (id: string, lane: number) => {
		if (placed.has(id)) return;
		placed.add(id);
		const y = laneCursor.get(lane) ?? 0;
		cards.push({ id, x: lane * (CARD_WIDTH + LANE_GAP), y });
		laneCursor.set(lane, y + CARD_HEIGHT + ROW_GAP);

		const kids = children.get(id) ?? [];
		kids.forEach((kidId, index) => {
			const kidLane = index === 0 ? lane : nextLane++;
			if (index > 0) laneCursor.set(kidLane, y + CARD_HEIGHT + ROW_GAP);
			edges.push({ from: id, to: kidId });
			visit(kidId, kidLane);
		});
	};

	for (const root of roots) visit(root, nextLane++);
	for (const node of nodes) {
		if (!placed.has(node.id)) visit(node.id, nextLane++);
	}

	let width = 0;
	let height = 0;
	for (const card of cards) {
		width = Math.max(width, card.x + CARD_WIDTH);
		height = Math.max(height, card.y + CARD_HEIGHT);
	}
	return { cards, edges, width, height };
}
