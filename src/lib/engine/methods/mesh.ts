/**
 * Method 3: Planar Mesh Analysis (with Supermeshes & Non-Planarity Detection).
 *
 * Uses Demoucron's planar face-splitting algorithm on each 2-connected block of the
 * active conducting multigraph to extract true planar interior window meshes (2-basis).
 * Detects non-planar topologies (K_5, K_{3,3} subdivisions) cleanly.
 * Detects perimeter and shared current sources (supermeshes), solves Z * I_m = V
 * independently, converts mesh currents -> branch currents, and cross-verifies against MNA.
 */

import { Complex } from '../complex';
import {
	buildElectricalGraph,
	parseDependentGain,
	parseSourceValue,
	resolveDependentControlNodes
} from '../graph';
import { matrixToLatex, solveComplexLinearSystem } from '../linalg';
import {
	isDependentCurrentSource,
	isDependentSourceKind,
	isDependentVoltageSource,
	type CircuitComponent,
	type CircuitDocument,
	type MethodResult,
	type MnaSolution,
	type SolutionStep
} from '../types';
import {
	formatDependentSourceExpr,
	formatLatexTerm,
	formatLatexValue,
	getPassiveImpedance,
	latexSub,
	verifyAgainstMna
} from './shared';

interface MultiEdge {
	id: number;
	comp: CircuitComponent;
	u: string; // pin0 node
	v: string; // pin1 node
}

interface OrientedEdgeRef {
	edgeId: number;
	dir: 1 | -1; // +1 if mesh traversal goes u -> v (pin0 -> pin1)
}

interface MeshLoop {
	id: number;
	edges: OrientedEdgeRef[];
}

/**
 * Extracts biconnected blocks (vertex sets + edge lists) via Tarjan's algorithm.
 */
function findBiconnectedBlocks(
	vertices: string[],
	edges: MultiEdge[]
): Array<{ vertices: string[]; edges: MultiEdge[] }> {
	const adj = new Map<string, Array<{ edge: MultiEdge; other: string }>>();
	for (const v of vertices) adj.set(v, []);
	for (const e of edges) {
		adj.get(e.u)!.push({ edge: e, other: e.v });
		if (e.u !== e.v) {
			adj.get(e.v)!.push({ edge: e, other: e.u });
		}
	}

	const dfn = new Map<string, number>();
	const low = new Map<string, number>();
	const edgeStack: MultiEdge[] = [];
	const visitedEdges = new Set<number>();
	const blocks: Array<{ vertices: string[]; edges: MultiEdge[] }> = [];
	let timer = 0;

	const dfs = (u: string, parentEdgeId: number) => {
		timer++;
		dfn.set(u, timer);
		low.set(u, timer);

		for (const { edge, other } of adj.get(u) ?? []) {
			if (edge.id === parentEdgeId) continue;

			if (edge.u === edge.v) {
				if (!visitedEdges.has(edge.id)) {
					visitedEdges.add(edge.id);
					blocks.push({ vertices: [edge.u], edges: [edge] });
				}
				continue;
			}

			if (!visitedEdges.has(edge.id)) {
				visitedEdges.add(edge.id);
				edgeStack.push(edge);
			}

			if (!dfn.has(other)) {
				dfs(other, edge.id);
				low.set(u, Math.min(low.get(u)!, low.get(other)!));
				if (low.get(other)! >= dfn.get(u)!) {
					const blockEdges: MultiEdge[] = [];
					const blockVerts = new Set<string>();
					while (edgeStack.length > 0) {
						const top = edgeStack.pop()!;
						blockEdges.push(top);
						blockVerts.add(top.u);
						blockVerts.add(top.v);
						if (top.id === edge.id) break;
					}
					blocks.push({ vertices: Array.from(blockVerts), edges: blockEdges });
				}
			} else {
				low.set(u, Math.min(low.get(u)!, dfn.get(other)!));
			}
		}
	};

	for (const v of vertices) {
		if (!dfn.has(v)) {
			dfs(v, -1);
		}
	}
	return blocks;
}

/**
 * Extracts planar interior window meshes for a single 2-connected multigraph block
 * using parallel-edge peeling + Demoucron's face-splitting planarity algorithm.
 * Returns `null` if the block is non-planar.
 */
function extractPlanarMeshesForBlock(
	blockVertices: string[],
	blockEdges: MultiEdge[]
): OrientedEdgeRef[][] | null {
	if (blockEdges.length === 0) return [];
	// Single bridge edge: no cycles
	if (blockEdges.length === 1) {
		if (blockEdges[0].u === blockEdges[0].v) {
			return [[{ edgeId: blockEdges[0].id, dir: 1 }]];
		}
		return [];
	}

	// Self-loops (already 1-edge blocks above, but guard anyway)
	if (blockVertices.length === 1) {
		return blockEdges.map((e) => [{ edgeId: e.id, dir: 1 }]);
	}

	// Group parallel edges between identical unordered vertex pairs
	const pairKey = (a: string, b: string) => (a < b ? `${a}\0${b}` : `${b}\0${a}`);
	const parallelGroups = new Map<string, MultiEdge[]>();
	for (const e of blockEdges) {
		const key = pairKey(e.u, e.v);
		const list = parallelGroups.get(key) ?? [];
		list.push(e);
		parallelGroups.set(key, list);
	}

	// If block has only 2 vertices (e.g. pure parallel bank), emit (k - 1) 2-cycles directly
	if (blockVertices.length === 2) {
		const group = Array.from(parallelGroups.values())[0];
		const meshes: OrientedEdgeRef[][] = [];
		for (let i = 0; i + 1 < group.length; i++) {
			const e1 = group[i];
			const e2 = group[i + 1];
			// Traverse e1 forward (u -> v), then e2 back (v -> u)
			const dir2: 1 | -1 = e2.v === e1.v && e2.u === e1.u ? -1 : 1;
			meshes.push([
				{ edgeId: e1.id, dir: 1 },
				{ edgeId: e2.id, dir: dir2 }
			]);
		}
		return meshes;
	}

	// Simple graph H with one representative edge per parallel group
	const simpleEdges = Array.from(parallelGroups.values()).map((g) => g[0]);
	const V = blockVertices.length;
	const E = simpleEdges.length;

	// Euler planarity necessary condition for simple planar graph with V >= 3
	if (V >= 3 && E > 3 * V - 6) {
		return null;
	}

	const simpleEdgeByPair = new Map<string, MultiEdge>();
	const adjSimple = new Map<string, string[]>();
	for (const v of blockVertices) adjSimple.set(v, []);
	for (const e of simpleEdges) {
		simpleEdgeByPair.set(pairKey(e.u, e.v), e);
		adjSimple.get(e.u)!.push(e.v);
		adjSimple.get(e.v)!.push(e.u);
	}

	// Find an initial cycle in simple graph H via DFS
	const findInitialCycle = (): string[] => {
		const parent = new Map<string, string | null>();
		const depth = new Map<string, number>();
		const stack: Array<{ u: string; p: string | null }> = [{ u: blockVertices[0], p: null }];
		parent.set(blockVertices[0], null);
		depth.set(blockVertices[0], 0);

		const dfsCycle = (u: string, p: string | null): string[] | null => {
			for (const w of adjSimple.get(u)!) {
				if (w === p) continue;
				if (depth.has(w)) {
					if (depth.get(w)! < depth.get(u)!) {
						const cyc: string[] = [w];
						let cur: string | null = u;
						while (cur && cur !== w) {
							cyc.push(cur);
							cur = parent.get(cur) ?? null;
						}
						cyc.reverse();
						return cyc;
					}
				} else {
					parent.set(w, u);
					depth.set(w, depth.get(u)! + 1);
					const res = dfsCycle(w, u);
					if (res) return res;
				}
			}
			return null;
		};
		void stack;
		return dfsCycle(blockVertices[0], null) ?? [];
	};

	const initCycle = findInitialCycle();
	if (initCycle.length < 3) {
		return null;
	}

	// Faces are stored as ordered cyclic lists of vertex IDs
	let faces: string[][] = [initCycle, [...initCycle].reverse()];
	const embeddedV = new Set<string>(initCycle);
	const embeddedPairKeys = new Set<string>();
	for (let i = 0; i < initCycle.length; i++) {
		const a = initCycle[i];
		const b = initCycle[(i + 1) % initCycle.length];
		embeddedPairKeys.add(pairKey(a, b));
	}

	interface Bridge {
		attachments: string[];
		pathBetween(a: string, b: string): string[];
	}

	const computeBridges = (): Bridge[] => {
		const bridges: Bridge[] = [];

		// 1. Chord bridges: unembedded edges with both endpoints in embeddedV
		for (const e of simpleEdges) {
			const pk = pairKey(e.u, e.v);
			if (embeddedPairKeys.has(pk)) continue;
			if (embeddedV.has(e.u) && embeddedV.has(e.v)) {
				bridges.push({
					attachments: [e.u, e.v],
					pathBetween: (a, b) => [a, b]
				});
			}
		}

		// 2. Component bridges: connected components of vertices NOT in embeddedV
		const unembVerts = blockVertices.filter((v) => !embeddedV.has(v));
		const visited = new Set<string>();

		for (const start of unembVerts) {
			if (visited.has(start)) continue;
			const compVerts = new Set<string>([start]);
			const attachmentsSet = new Set<string>();
			const queue = [start];
			visited.add(start);

			while (queue.length > 0) {
				const u = queue.shift()!;
				for (const w of adjSimple.get(u)!) {
					if (embeddedV.has(w)) {
						attachmentsSet.add(w);
					} else if (!visited.has(w)) {
						visited.add(w);
						compVerts.add(w);
						queue.push(w);
					}
				}
			}

			const attachments = Array.from(attachmentsSet);
			bridges.push({
				attachments,
				pathBetween: (a, b) => {
					// BFS from a to b using only vertices in compVerts (and endpoints a, b)
					const prev = new Map<string, string>();
					const vis = new Set<string>([a]);
					const q: string[] = [];
					for (const w of adjSimple.get(a)!) {
						if (compVerts.has(w)) {
							vis.add(w);
							prev.set(w, a);
							q.push(w);
						}
					}
					while (q.length > 0) {
						const cur = q.shift()!;
						for (const nxt of adjSimple.get(cur)!) {
							if (nxt === b) {
								const path = [b];
								let p: string | undefined = cur;
								while (p !== undefined) {
									path.push(p);
									p = prev.get(p);
								}
								path.reverse();
								return path;
							}
							if (compVerts.has(nxt) && !vis.has(nxt)) {
								vis.add(nxt);
								prev.set(nxt, cur);
								q.push(nxt);
							}
						}
					}
					return [a, b];
				}
			});
		}

		return bridges;
	};

	// Demoucron face-splitting loop
	while (embeddedPairKeys.size < E) {
		const bridges = computeBridges();
		if (bridges.length === 0) break;

		let chosenBridge: Bridge | null = null;
		let chosenFaceIdx = -1;
		let minChoices = Infinity;

		for (const br of bridges) {
			const admissible: number[] = [];
			for (let fIdx = 0; fIdx < faces.length; fIdx++) {
				const fSet = new Set(faces[fIdx]);
				if (br.attachments.every((att) => fSet.has(att))) {
					admissible.push(fIdx);
				}
			}
			if (admissible.length === 0) {
				// Non-planar graph detected!
				return null;
			}
			if (admissible.length < minChoices) {
				minChoices = admissible.length;
				chosenBridge = br;
				chosenFaceIdx = admissible[0];
				if (minChoices === 1) break;
			}
		}

		if (!chosenBridge || chosenFaceIdx < 0) return null;

		const attA = chosenBridge.attachments[0];
		const attB = chosenBridge.attachments[1];
		const path = chosenBridge.pathBetween(attA, attB);
		const face = faces[chosenFaceIdx];

		// Rotate face so attA is at index 0
		const posA = face.indexOf(attA);
		const rotated = [...face.slice(posA), ...face.slice(0, posA)];
		const posB = rotated.indexOf(attB);
		const interiorPath = path.slice(1, -1); // vertices strictly between attA and attB

		const face1 = [...rotated.slice(0, posB + 1), ...[...interiorPath].reverse()];
		const face2 = [attB, ...rotated.slice(posB + 1), attA, ...interiorPath];

		faces.splice(chosenFaceIdx, 1, face1, face2);

		for (let i = 0; i < path.length; i++) {
			embeddedV.add(path[i]);
			if (i + 1 < path.length) {
				embeddedPairKeys.add(pairKey(path[i], path[i + 1]));
			}
		}
	}

	// Drop the longest face as the outer face (leaving E - V + 1 interior meshes)
	let outerIdx = 0;
	for (let i = 1; i < faces.length; i++) {
		if (faces[i].length > faces[outerIdx].length) {
			outerIdx = i;
		}
	}
	const interiorFaces = faces.filter((_, idx) => idx !== outerIdx);

	// Convert vertex cycles into OrientedEdgeRef cycles
	const meshes: OrientedEdgeRef[][] = interiorFaces.map((f) => {
		const refs: OrientedEdgeRef[] = [];
		for (let i = 0; i < f.length; i++) {
			const a = f[i];
			const b = f[(i + 1) % f.length];
			const e = simpleEdgeByPair.get(pairKey(a, b))!;
			refs.push({
				edgeId: e.id,
				dir: e.u === a && e.v === b ? 1 : -1
			});
		}
		return refs;
	});

	// Re-insert parallel twin edges without violating 2-mesh-per-edge property
	for (const group of parallelGroups.values()) {
		if (group.length <= 1) continue;
		const rep = group[0];

		// Find all interior meshes currently containing `rep`
		const hostPositions: Array<{ meshIdx: number; refIdx: number; dir: 1 | -1 }> = [];
		meshes.forEach((m, mIdx) => {
			m.forEach((ref, rIdx) => {
				if (ref.edgeId === rep.id) {
					hostPositions.push({ meshIdx: mIdx, refIdx: rIdx, dir: ref.dir });
				}
			});
		});

		const firstHost = hostPositions[0];
		const baseDir: 1 | -1 = firstHost ? firstHost.dir : 1;
		// Chain 2-cycles using opposite direction on `prev` relative to firstHost so `rep` appears <= 2 times
		const getOriented = (edge: MultiEdge, wantForwardRelRep: boolean): OrientedEdgeRef => {
			const sameOrientationAsRep = edge.u === rep.u && edge.v === rep.v;
			const forwardAsRep: 1 | -1 = sameOrientationAsRep ? baseDir : (baseDir === 1 ? -1 : 1) as 1 | -1;
			return {
				edgeId: edge.id,
				dir: wantForwardRelRep ? forwardAsRep : ((forwardAsRep === 1 ? -1 : 1) as 1 | -1)
			};
		};

		for (let i = 0; i + 1 < group.length; i++) {
			const prevEdge = group[i];
			const nextEdge = group[i + 1];
			// 2-cycle: traverse prevEdge opposite to firstHost, then nextEdge same as firstHost
			meshes.push([getOriented(prevEdge, false), getOriented(nextEdge, true)]);
		}

		// If `rep` appeared in a second interior mesh, swap that second occurrence to `lastEdge`
		if (hostPositions.length >= 2) {
			const secondHost = hostPositions[1];
			const lastEdge = group[group.length - 1];
			const sameOrientationAsRep = lastEdge.u === rep.u && lastEdge.v === rep.v;
			meshes[secondHost.meshIdx][secondHost.refIdx] = {
				edgeId: lastEdge.id,
				dir: sameOrientationAsRep
					? secondHost.dir
					: ((secondHost.dir === 1 ? -1 : 1) as 1 | -1)
			};
		}
	}

	return meshes;
}

export function solveMesh(doc: CircuitDocument, mna: MnaSolution): MethodResult {
	const title = 'Mesh Analysis';
	if (!mna.valid) {
		return {
			methodId: 'mesh',
			title,
			applicable: false,
			inapplicableReason: 'Circuit has topology or value errors; fix validation errors first.',
			steps: []
		};
	}

	const graph = buildElectricalGraph(doc);
	const mode = mna.mode;
	const freq = mna.frequencyHz;

	const twoTerminal = doc.components.filter(
		(c) => c.kind !== 'ground' && c.kind !== 'terminal'
	);

	// Active conducting edges (exclude DC open capacitors, whose current is 0)
	const conductingEdges: MultiEdge[] = [];
	const openCapacitors: CircuitComponent[] = [];
	for (const comp of twoTerminal) {
		if (mode === 'dc' && comp.kind === 'capacitor') {
			openCapacitors.push(comp);
			continue;
		}
		const [u, v] = graph.componentNodes[comp.id];
		conductingEdges.push({ id: conductingEdges.length, comp, u, v });
	}

	const allVerts = Object.keys(graph.nodes);
	const blocks = findBiconnectedBlocks(allVerts, conductingEdges);

	const allMeshEdgeLists: OrientedEdgeRef[][] = [];
	for (const block of blocks) {
		const blockMeshes = extractPlanarMeshesForBlock(block.vertices, block.edges);
		if (blockMeshes === null) {
			return {
				methodId: 'mesh',
				title,
				applicable: false,
				inapplicableReason:
					'Circuit graph is non-planar (contains a K₅ or K₃,₃ subdivision). Planar Mesh Analysis only applies to planar circuits; use Nodal Analysis or MNA instead.',
				steps: [
					{
						title: 'Non-Planar Topology Detected',
						description:
							'This circuit cannot be drawn in a plane without crossing wires, so a 2-basis of window meshes does not exist. Use Nodal Analysis or general Loop Analysis.'
					}
				]
			};
		}
		allMeshEdgeLists.push(...blockMeshes);
	}

	const meshes: MeshLoop[] = allMeshEdgeLists.map((edges, id) => ({ id, edges }));
	const M = meshes.length;

	// Map each conducting edge -> which meshes contain it
	const edgeIncidence = new Map<number, Array<{ meshId: number; dir: 1 | -1 }>>();
	for (const e of conductingEdges) edgeIncidence.set(e.id, []);
	for (const mesh of meshes) {
		for (const ref of mesh.edges) {
			edgeIncidence.get(ref.edgeId)!.push({ meshId: mesh.id, dir: ref.dir });
		}
	}

	if (M === 0) {
		// Tree-only conducting graph (every conducting branch current is 0)
		const branchCurrents: Record<string, Complex> = {};
		for (const comp of twoTerminal) branchCurrents[comp.id] = Complex.zero();
		const verification = verifyAgainstMna(mna, { branchCurrents });
		return {
			methodId: 'mesh',
			title,
			applicable: true,
			steps: [
				{
					title: '1. Mesh Identification',
					description: 'Circuit contains no closed conducting loops; all branch currents are 0 A.',
					latex: ['I = 0\\text{ A}']
				}
			],
			summaryLatex: 'I = 0\\text{ A}',
			...verification
		};
	}

	interface MeshLinearExpr {
		terms: Map<number, Complex>;
		constant: Complex;
	}

	const addMeshTerm = (map: Map<number, Complex>, meshId: number, coeff: Complex) => {
		const prev = map.get(meshId);
		map.set(meshId, prev ? prev.add(coeff) : coeff);
	};

	const scaleMeshExpr = (expr: MeshLinearExpr, factor: Complex): MeshLinearExpr => {
		const terms = new Map<number, Complex>();
		for (const [m, c] of expr.terms.entries()) {
			terms.set(m, c.mul(factor));
		}
		return { terms, constant: expr.constant.mul(factor) };
	};

	const edgeByCompId = new Map<string, MultiEdge>();
	for (const e of conductingEdges) edgeByCompId.set(e.comp.id, e);

	// Adjacency of non-current-source conducting edges (for finding voltage paths between any two nodes)
	const voltagePathAdj = new Map<string, Array<{ edge: MultiEdge; other: string; dir: 1 | -1 }>>();
	for (const v of allVerts) voltagePathAdj.set(v, []);
	for (const e of conductingEdges) {
		if (e.comp.kind === 'current_source' || isDependentCurrentSource(e.comp.kind)) continue;
		voltagePathAdj.get(e.u)!.push({ edge: e, other: e.v, dir: 1 });
		voltagePathAdj.get(e.v)!.push({ edge: e, other: e.u, dir: -1 });
	}

	const resolveBranchCurrentInMeshes = (compId: string): MeshLinearExpr => {
		const edge = edgeByCompId.get(compId);
		const terms = new Map<number, Complex>();
		if (!edge) return { terms, constant: Complex.zero() };
		for (const { meshId, dir } of edgeIncidence.get(edge.id) ?? []) {
			addMeshTerm(terms, meshId, Complex.from(dir, 0));
		}
		return { terms, constant: Complex.zero() };
	};

	const resolveNodeDiffVoltageInMeshes = (
		startNode: string,
		endNode: string,
		visited: Set<string>
	): MeshLinearExpr | null => {
		if (startNode === endNode) return { terms: new Map(), constant: Complex.zero() };
		const visitedNodes = new Set<string>([startNode]);
		const parent = new Map<string, { prev: string; edge: MultiEdge; dir: 1 | -1 }>();
		const queue = [startNode];
		let found = false;

		while (queue.length > 0) {
			const u = queue.shift()!;
			if (u === endNode) {
				found = true;
				break;
			}
			for (const step of voltagePathAdj.get(u) ?? []) {
				if (!visitedNodes.has(step.other)) {
					visitedNodes.add(step.other);
					parent.set(step.other, { prev: u, edge: step.edge, dir: step.dir });
					queue.push(step.other);
				}
			}
		}

		if (!found) return null;

		const terms = new Map<number, Complex>();
		let constant = Complex.zero();
		let cur = endNode;
		while (cur !== startNode) {
			const step = parent.get(cur)!;
			const edgeV = resolveEdgeVoltageInMeshes(step.edge, visited);
			if (!edgeV) return null;
			const s = Complex.from(step.dir, 0);
			for (const [m, c] of edgeV.terms.entries()) {
				addMeshTerm(terms, m, c.mul(s));
			}
			constant = constant.add(edgeV.constant.mul(s));
			cur = step.prev;
		}
		return { terms, constant };
	};

	const resolveEdgeVoltageInMeshes = (
		edge: MultiEdge,
		visited: Set<string>
	): MeshLinearExpr | null => {
		const comp = edge.comp;
		if (visited.has(comp.id)) return null;
		visited.add(comp.id);

		let res: MeshLinearExpr | null = null;
		if (comp.kind === 'voltage_source') {
			res = { terms: new Map(), constant: parseSourceValue(comp, mode)! };
		} else if (comp.kind === 'vcvs') {
			const ctrl = resolveDependentControlNodes(comp, graph)!;
			const pol = comp.controlRef?.controlPolarity ?? 1;
			const av = parseDependentGain(comp, mode)!.scale(pol);
			const ctrlV = resolveNodeDiffVoltageInMeshes(ctrl.ctrlPos, ctrl.ctrlNeg, visited);
			if (ctrlV) res = scaleMeshExpr(ctrlV, av);
		} else if (comp.kind === 'ccvs') {
			const pol = comp.controlRef?.controlPolarity ?? 1;
			const rm = parseDependentGain(comp, mode)!.scale(pol);
			const ctrlI = resolveBranchCurrentInMeshes(comp.controlRef!.controlBranchComponentId!);
			res = scaleMeshExpr(ctrlI, rm);
		} else if (comp.kind === 'resistor' || comp.kind === 'capacitor' || comp.kind === 'inductor') {
			const z = getPassiveImpedance(comp, mode, freq);
			if (!z || z.isZero(1e-15)) {
				res = { terms: new Map(), constant: Complex.zero() };
			} else {
				res = scaleMeshExpr(resolveBranchCurrentInMeshes(comp.id), z);
			}
		}

		visited.delete(comp.id);
		return res;
	};

	const resolveDependentCurrentInMeshes = (comp: CircuitComponent): MeshLinearExpr | null => {
		const pol = comp.controlRef?.controlPolarity ?? 1;
		const gain = parseDependentGain(comp, mode)!.scale(pol);
		if (comp.kind === 'vccs') {
			const ctrl = resolveDependentControlNodes(comp, graph)!;
			const ctrlV = resolveNodeDiffVoltageInMeshes(ctrl.ctrlPos, ctrl.ctrlNeg, new Set([comp.id]));
			return ctrlV ? scaleMeshExpr(ctrlV, gain) : null;
		}
		if (comp.kind === 'cccs') {
			const ctrlI = resolveBranchCurrentInMeshes(comp.controlRef!.controlBranchComponentId!);
			return scaleMeshExpr(ctrlI, gain);
		}
		return null;
	};

	// Identify current sources (independent AND dependent): perimeter (1 mesh) vs shared (2 meshes -> Supermesh!)
	const perimeterCS: Array<{ edge: MultiEdge; meshId: number; dir: 1 | -1 }> = [];
	const sharedCS: Array<{
		edge: MultiEdge;
		mA: { meshId: number; dir: 1 | -1 };
		mB: { meshId: number; dir: 1 | -1 };
	}> = [];

	for (const e of conductingEdges) {
		if (e.comp.kind !== 'current_source' && !isDependentCurrentSource(e.comp.kind)) continue;
		const inc = edgeIncidence.get(e.id)!;
		if (inc.length === 1) {
			perimeterCS.push({ edge: e, meshId: inc[0].meshId, dir: inc[0].dir });
		} else if (inc.length === 2) {
			sharedCS.push({ edge: e, mA: inc[0], mB: inc[1] });
		}
	}

	// Group meshes into supermeshes via shared current sources
	const ufMesh = Array.from({ length: M }, (_, i) => i);
	const findMeshGroup = (x: number): number => {
		while (ufMesh[x] !== x) x = ufMesh[x];
		return x;
	};
	for (const scs of sharedCS) {
		const rA = findMeshGroup(scs.mA.meshId);
		const rB = findMeshGroup(scs.mB.meshId);
		if (rA !== rB) ufMesh[rA] = rB;
	}

	const supermeshGroups = new Map<number, number[]>();
	for (let m = 0; m < M; m++) {
		const root = findMeshGroup(m);
		const list = supermeshGroups.get(root) ?? [];
		list.push(m);
		supermeshGroups.set(root, list);
	}

	// Assemble M x M mesh system: Z * I_m = V
	const Z: Complex[][] = Array.from({ length: M }, () =>
		Array.from({ length: M }, () => Complex.zero())
	);
	const rhs: Complex[] = Array.from({ length: M }, () => Complex.zero());
	const kvlLatex: string[] = [];
	const csLatex: string[] = [];
	const dependentLatex: string[] = [];
	let row = 0;

	for (const comp of twoTerminal) {
		if (!isDependentSourceKind(comp.kind)) continue;
		const sub = latexSub(comp.label);
		const lhs = isDependentVoltageSource(comp.kind) ? `V_{${sub}}` : `I_{${sub}}`;
		dependentLatex.push(`${lhs} = ${formatDependentSourceExpr(comp, doc, mode)}`);
	}

	// Helper to write KVL around the boundary of a set of meshes (canceling internal shared edges)
	const writeSupermeshKvl = (groupMeshIds: number[]): boolean => {
		const netEdgeDir = new Map<number, number>();
		for (const mId of groupMeshIds) {
			for (const ref of meshes[mId].edges) {
				netEdgeDir.set(ref.edgeId, (netEdgeDir.get(ref.edgeId) ?? 0) + ref.dir);
			}
		}

		const terms: string[] = [];
		for (const [edgeId, netDir] of netEdgeDir.entries()) {
			if (netDir === 0) continue;
			const edge = conductingEdges[edgeId];
			if (edge.comp.kind === 'current_source' || isDependentCurrentSource(edge.comp.kind)) {
				continue;
			}

			if (edge.comp.kind === 'voltage_source') {
				const vs = parseSourceValue(edge.comp, mode)!;
				rhs[row] = rhs[row].sub(vs.scale(netDir));
				const signStr = netDir > 0 ? '+' : '-';
				terms.push(`${signStr} ${formatLatexTerm(vs, mode)}`);
				continue;
			}

			if (isDependentVoltageSource(edge.comp.kind)) {
				const vExpr = resolveEdgeVoltageInMeshes(edge, new Set());
				if (!vExpr) return false;
				for (const [m, c] of vExpr.terms.entries()) {
					Z[row][m] = Z[row][m].add(c.scale(netDir));
				}
				rhs[row] = rhs[row].sub(vExpr.constant.scale(netDir));
				const exprTex = formatDependentSourceExpr(edge.comp, doc, mode);
				terms.push(`${netDir > 0 ? '+' : '-'} ${exprTex}`);
				continue;
			}

			const zBranch = getPassiveImpedance(edge.comp, mode, freq);
			if (!zBranch || zBranch.isZero(1e-15)) continue;

			const inc = edgeIncidence.get(edgeId)!;
			const meshCombo: string[] = [];
			for (const { meshId, dir } of inc) {
				const coeff = zBranch.scale(netDir * dir);
				Z[row][meshId] = Z[row][meshId].add(coeff);
				const sign = dir > 0 ? '+' : '-';
				meshCombo.push(`${sign} I_{m${meshId + 1}}`);
			}
			const comboClean = meshCombo.join(' ').replace(/^\+\s*/, '');
			terms.push(
				`${netDir > 0 ? '+' : '-'} ${formatLatexTerm(zBranch, mode)}(${comboClean})`
			);
		}

		const prefix =
			groupMeshIds.length > 1
				? `\\text{Supermesh } \\{${groupMeshIds.map((m) => `m_{${m + 1}}`).join(', ')}\\}:\\; `
				: `\\text{Mesh } ${groupMeshIds[0] + 1}:\\; `;
		if (terms.length > 2) {
			const cleanTerms = terms.map((t, i) => (i === 0 ? t.replace(/^\+\s*/, '') : t));
			const lines: string[] = [];
			for (let i = 0; i < cleanTerms.length; i += 2) {
				lines.push(cleanTerms.slice(i, i + 2).join(' '));
			}
			kvlLatex.push(`\\begin{aligned} ${prefix}&${lines.join(' \\\\ &')} = 0 \\end{aligned}`);
		} else {
			const eqBody = terms.join(' ').replace(/^\+\s*/, '') || '0';
			kvlLatex.push(`${prefix}${eqBody} = 0`);
		}
		row++;
		return true;
	};

	for (const groupMeshIds of supermeshGroups.values()) {
		const groupSet = new Set(groupMeshIds);
		const groupPerim = perimeterCS.filter((p) => groupSet.has(p.meshId));
		const groupShared = sharedCS.filter(
			(s) => groupSet.has(s.mA.meshId) && groupSet.has(s.mB.meshId)
		);

		for (const p of groupPerim) {
			Z[row][p.meshId] = Z[row][p.meshId].add(Complex.from(p.dir, 0));
			const sign = p.dir > 0 ? '' : '-';
			if (p.edge.comp.kind === 'current_source') {
				const is = parseSourceValue(p.edge.comp, mode)!;
				rhs[row] = rhs[row].add(is);
				csLatex.push(
					`\\text{${latexSub(p.edge.comp.label)} (perimeter):}\\; ${sign}I_{m${p.meshId + 1}} = ${formatLatexValue(is, mode)}\\text{ A}`
				);
			} else {
				const depI = resolveDependentCurrentInMeshes(p.edge.comp);
				if (!depI) {
					return {
						methodId: 'mesh',
						title,
						applicable: false,
						inapplicableReason: `Could not express dependent current source ${p.edge.comp.label} in terms of mesh currents.`,
						steps: []
					};
				}
				for (const [m, c] of depI.terms.entries()) {
					Z[row][m] = Z[row][m].sub(c);
				}
				rhs[row] = rhs[row].add(depI.constant);
				csLatex.push(
					`\\text{${latexSub(p.edge.comp.label)} (perimeter):}\\; ${sign}I_{m${p.meshId + 1}} = ${formatDependentSourceExpr(p.edge.comp, doc, mode)}`
				);
			}
			row++;
		}

		for (const s of groupShared) {
			Z[row][s.mA.meshId] = Z[row][s.mA.meshId].add(Complex.from(s.mA.dir, 0));
			Z[row][s.mB.meshId] = Z[row][s.mB.meshId].add(Complex.from(s.mB.dir, 0));
			const tA = `${s.mA.dir > 0 ? '' : '-'}I_{m${s.mA.meshId + 1}}`;
			const tB = `${s.mB.dir > 0 ? '+' : '-'} I_{m${s.mB.meshId + 1}}`;
			if (s.edge.comp.kind === 'current_source') {
				const is = parseSourceValue(s.edge.comp, mode)!;
				rhs[row] = rhs[row].add(is);
				csLatex.push(
					`\\text{${latexSub(s.edge.comp.label)} (supermesh):}\\; ${tA} ${tB} = ${formatLatexValue(is, mode)}\\text{ A}`
				);
			} else {
				const depI = resolveDependentCurrentInMeshes(s.edge.comp);
				if (!depI) {
					return {
						methodId: 'mesh',
						title,
						applicable: false,
						inapplicableReason: `Could not express dependent current source ${s.edge.comp.label} in terms of mesh currents.`,
						steps: []
					};
				}
				for (const [m, c] of depI.terms.entries()) {
					Z[row][m] = Z[row][m].sub(c);
				}
				rhs[row] = rhs[row].add(depI.constant);
				csLatex.push(
					`\\text{${latexSub(s.edge.comp.label)} (supermesh):}\\; ${tA} ${tB} = ${formatDependentSourceExpr(s.edge.comp, doc, mode)}`
				);
			}
			row++;
		}

		if (groupPerim.length === 0) {
			if (!writeSupermeshKvl(groupMeshIds)) {
				return {
					methodId: 'mesh',
					title,
					applicable: false,
					inapplicableReason: 'Could not express dependent source controlling voltage in terms of mesh currents.',
					steps: []
				};
			}
		}
	}

	if (row !== M) {
		return {
			methodId: 'mesh',
			title,
			applicable: false,
			inapplicableReason: `Mesh equation count mismatch (${row} equations for ${M} meshes).`,
			steps: []
		};
	}

	const solved = solveComplexLinearSystem(Z, rhs);
	if (solved.singular) {
		return {
			methodId: 'mesh',
			title,
			applicable: false,
			inapplicableReason: 'Mesh impedance matrix Z is singular.',
			steps: []
		};
	}

	const meshCurrents = solved.x;
	const branchCurrents: Record<string, Complex> = {};
	for (const cap of openCapacitors) {
		branchCurrents[cap.id] = Complex.zero();
	}
	for (const e of conductingEdges) {
		let sum = Complex.zero();
		for (const { meshId, dir } of edgeIncidence.get(e.id)!) {
			sum = sum.add(meshCurrents[meshId].scale(dir));
		}
		branchCurrents[e.comp.id] = sum;
	}

	const meshDescribeLatex = meshes.map((m) => {
		const pathStr = m.edges
			.map((ref) => {
				const s = latexSub(conductingEdges[ref.edgeId].comp.label);
				return ref.dir > 0 ? s : `-${s}`;
			})
			.join(', ');
		return `I_{m${m.id + 1}}:\\; [${pathStr}]`;
	});

	const solvedMeshLatex = meshCurrents.map(
		(im, idx) => `I_{m${idx + 1}} = ${formatLatexValue(im, mode)}\\text{ A}`
	);

	const branchLatex = twoTerminal.map((c) => {
		const s = latexSub(c.label);
		return `I_{${s}} = ${formatLatexValue(branchCurrents[c.id], mode)}\\text{ A}`;
	});

	const steps: SolutionStep[] = [];
	let stepNum = 1;

	steps.push({
		title: `${stepNum++}. Planar Mesh Identification`,
		description: `Extracted ${M} independent planar window meshes from the conducting multigraph.`,
		latex: meshDescribeLatex
	});

	if (dependentLatex.length > 0) {
		steps.push({
			title: `${stepNum++}. Dependent Source Controlling Variables`,
			description:
				'Express each dependent source controlling variable in terms of mesh currents before substituting into KVL and supermesh equations.',
			latex: dependentLatex
		});
	}

	if (csLatex.length > 0) {
		steps.push({
			title: `${stepNum++}. Supermesh & Current-Source Constraints`,
			description:
				'Current sources (independent or dependent) either fix perimeter mesh currents or form supermeshes combining adjacent meshes.',
			latex: csLatex
		});
	}

	steps.push({
		title: `${stepNum++}. Mesh KVL Equations`,
		description: 'Sum voltage drops around each independent mesh and supermesh to zero.',
		latex: kvlLatex.length > 0 ? kvlLatex : ['\\text{All mesh currents are fixed directly by current sources.}']
	});

	steps.push({
		title: `${stepNum++}. Mesh Matrix System`,
		description: `Assembled ${M}×${M} mesh impedance & constraint matrix.`,
		matrixLatex: matrixToLatex(
			Z,
			meshes.map((m) => `I_{m${m.id + 1}}`),
			rhs
		)
	});

	steps.push({
		title: `${stepNum++}. Solved Mesh & Branch Currents`,
		description: 'Computed mesh currents and combined overlapping mesh currents per branch.',
		latex: [...solvedMeshLatex, ...branchLatex.slice(0, 6)]
	});

	const verification = verifyAgainstMna(mna, { branchCurrents });

	return {
		methodId: 'mesh',
		title,
		applicable: true,
		steps,
		summaryLatex: `\\begin{aligned} ${solvedMeshLatex
			.map((s) => s.replace(' = ', ' &= '))
			.join(' \\\\ ')} \\end{aligned}`,
		...verification
	};
}
