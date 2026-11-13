import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { FORMATS3D, FORMATS2D, FORMATSIMG, export3d, collect2d, writeDxf, writeSvg, writePdf } from './export.js';
import { faceTriangles, analyzeFace, relate, mergeCoaxialFaces } from './measure-math.js';
import { compareSoups } from './compare.js';
import { analyzePart, chooseBlank, buildRoute, describePart, DEFAULT_EQUIPMENT } from './techproc.js';
import { renderSheets, renderDrawing, renderCuttingList } from './drawing.js';
import { pumaPrograms, kvlPrograms } from './gcode.js';
import { readDrawing, buildDrawing, drawingFormatName } from './cad2d.js';
import { parse3mf } from './threemf.js';

const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// =====================================================================
// Иконки
// =====================================================================
const CUBE = 'M12 3 20 7.5v9L12 21l-8-4.5v-9z';
const CUBE_IN = 'M12 12 20 7.5M12 12v9M12 12 4 7.5';
const ICONS = {
	rotate: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4.3h-4.3"/><circle cx="12" cy="12" r="2.2"/>',
	pan: '<path d="M12 3v18M3 12h18M9.5 5.5 12 3l2.5 2.5M9.5 18.5 12 21l2.5-2.5M5.5 9.5 3 12l2.5 2.5M18.5 9.5 21 12l-2.5 2.5"/>',
	zoom: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.8-4.8M10.5 7.5v6M7.5 10.5h6"/>',
	select: '<path d="M5 3.5 18 11l-5.8 1.7L9.6 19z"/><path d="m12.5 13 5 5"/>',
	section: `<path d="${CUBE}"/><path d="M3 10.5h18" stroke-dasharray="2.2 2"/><path d="m4 7.5 8 4.5 8-4.5"/>`,
	measure: '<path d="M3.5 16.5 16.5 3.5l4 4-13 13z"/><path d="m7.5 12.5 2 2M10.5 9.5l2 2M13.5 6.5l2 2"/>',
	ruler: '<path d="M3.5 16.5 16.5 3.5l4 4-13 13z"/><path d="m7.5 12.5 2 2M10.5 9.5l2 2M13.5 6.5l2 2"/>',
	hide: '<path d="m3 3 18 18"/><path d="M10.6 6.1Q11.3 6 12 6c5 0 9 6 9 6a17 17 0 0 1-2.6 3.2M6.6 6.6C4.3 8.1 3 12 3 12s4 6 9 6q2.3 0 4.3-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
	style: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 0 0 17z" fill="currentColor" stroke="none" opacity=".55"/><circle cx="15" cy="9" r="1.3"/>',
	animate: `<path d="M12 5.5 17 8.3v5.4L12 16.5l-5-2.8V8.3z"/><path d="M12 11 17 8.3M12 11v5.5M12 11 7 8.3"/><path d="M3 12.5c0 3.2 4 5.8 9 5.8s9-2.6 9-5.8"/><path d="m18.5 19.5 2.5-1.2-1.2-2.4"/>`,
	fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><rect x="8.5" y="8.5" width="7" height="7" rx="1"/>',
	eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
	eyeOff: '<path d="m3 3 18 18"/><path d="M10.6 6.1Q11.3 6 12 6c5 0 9 6 9 6a17 17 0 0 1-2.6 3.2M6.6 6.6C4.3 8.1 3 12 3 12s4 6 9 6q2.3 0 4.3-1"/>',
	camera: '<path d="M3.5 8h3.5l2-2.5h6L17 8h3.5v11h-17z"/><circle cx="12" cy="13" r="3.5"/>',
	panel: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M14.5 4.5v15"/>',
	fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
	folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.2h8.5A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
	clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
	star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z"/>',
	home: '<path d="M4 10.5 12 4l8 6.5V20h-5.5v-5.5h-5V20H4z"/>',
	sectionBox: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 12h16" stroke-dasharray="2.2 2"/><path d="M12 4v4M12 16v4"/>',
	analysis: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
	props: '<rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M12 4v2M12 18v2M4 12h2M18 12h2"/>',
	export: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
	fileCad: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="m12 10 3 1.7v3.4L12 16.8 9 15.1v-3.4z"/>',
	chevUp: '<path d="m6 15 6-6 6 6"/>',
	chevRight: '<path d="m9 6 6 6-6 6"/>',
	close: '<path d="M6 6l12 12M18 6 6 18"/>',
	copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
	com: `<path d="${CUBE}"/><path d="${CUBE_IN}" stroke-dasharray="1.6 1.6"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>`,
	dims: '<path d="M4 8h16M4 5v6M20 5v6"/><path d="M4 18h10M4 15v6M14 15v6"/>',
	compare: '<path d="M4 5h7v14H4z"/><path d="M13 5h7v14h-7z" stroke-dasharray="2 1.6"/><path d="M12 3v18"/>',
	route: '<path d="M6 4h9a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h9"/><circle cx="5" cy="4" r="1.6"/><circle cx="19" cy="16" r="1.6"/><path d="M14 20h6"/>',
	info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.4"/>',
	diameter: '<circle cx="12" cy="12" r="8"/><path d="M6.3 17.7 17.7 6.3"/><path d="M15 6.3h2.7V9M9 17.7H6.3V15"/>',
	faces: '<path d="M4 6h7v12H4z"/><path d="M13 6h7v12h-7z" opacity=".55"/><path d="M8 12h8M14 10l2 2-2 2M10 10l-2 2 2 2"/>',
	trash: '<path d="M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13"/>',
	part: `<path d="${CUBE}"/><path d="${CUBE_IN}"/>`,
	assembly: '<path d="M3.5 7A1.5 1.5 0 0 1 5 5.5h4l2 2h8A1.5 1.5 0 0 1 20.5 9v9a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18z"/>',
	cubeSolid: `<path d="${CUBE}" fill="currentColor" fill-opacity=".25"/><path d="${CUBE_IN}"/>`,
	cubeWire: `<path d="${CUBE}"/><path d="${CUBE_IN}"/><path d="M8 5.2v9.3M16 5.2v9.3M4 12l8 4.5 8-4.5" opacity=".6"/>`,
	cubeLines: `<path d="${CUBE}"/><path d="${CUBE_IN}"/><path d="M12 12 4 16.5M12 12l8 4.5M12 3v9" stroke-dasharray="1.5 1.8" opacity=".7"/>`,
	cubeShaded: `<path d="${CUBE}"/><path d="M12 12 20 7.5v9L12 21z" fill="currentColor" fill-opacity=".5"/><path d="${CUBE_IN}"/>`,
	sheet: '<path d="M5 3.5h10l4 4V20.5H5z"/><path d="M15 3.5v4h4"/><path d="M8 16.5h8M8 13.5h3M14 13.5h2"/><rect x="8" y="8" width="5" height="3"/>',
	blank: '<rect x="3" y="9" width="18" height="6" rx="1"/><path d="M9 9v6M15 9v6" stroke-dasharray="1.6 1.4"/><path d="M12 3v3M10.5 4.5 12 6l1.5-1.5"/>',
	cubeXray: `<path d="${CUBE}" stroke-dasharray="2 1.5"/><path d="${CUBE_IN}" stroke-dasharray="2 1.5"/><circle cx="12" cy="12" r="3"/>`,
};
function icon(name) { return `<svg viewBox="0 0 24 24">${ICONS[name] || ''}</svg>`; }
function renderIcons(root = document) {
	for (const el of $$('i[data-icon]', root)) el.innerHTML = icon(el.dataset.icon);
}
renderIcons();

// название и версия программы (app/version.json пишет сборка из файла VERSION)
let APP_TITLE = 'RafCAD View';
fetch('version.json').then((r) => r.json()).then((v) => {
	APP_TITLE = (v.name || 'RafCAD View') + ' ' + v.version;
	$('verBadge').textContent = 'v' + v.version;
	if (!model.name) document.title = APP_TITLE;
}).catch(() => { });

// =====================================================================
// Константы и настройки
// =====================================================================
const OCCT_FORMATS = { step: 'step', stp: 'step', iges: 'iges', igs: 'iges', brep: 'brep', brp: 'brep' };
// чертежи 2D (DXF, DWG): открываются видом сверху, без объёма и массы
const DRAW_FORMATS = { dxf: 'dxf', dwg: 'dwg' };
const SUPPORTED = ['step', 'stp', 'iges', 'igs', 'brep', 'brp', 'stl', 'obj', 'ply', '3mf', 'glb', 'gltf', 'dxf', 'dwg'];
const DRAW_FG = 0xe6ebf2; // цвет «белых» линий (ACI 7) на тёмном фоне
const QUALITY = {
	fast: { linearDeflection: 0.003, angularDeflection: 0.8 },
	normal: { linearDeflection: 0.001, angularDeflection: 0.5 },
	fine: { linearDeflection: 0.0002, angularDeflection: 0.2 },
};
const DEFAULT_COLOR = new THREE.Color().setRGB(0.74, 0.76, 0.8, THREE.SRGBColorSpace);
// почти чёрный серый цвет из CAD (часто «цвет по умолчанию» в IGES) показываем сталью
const isDarkGrey = (c) => { const h = c.getHSL({}); return h.s < 0.15 && h.l < 0.3; };
const EDGE_AUTO_LIMIT = 800000;

const settings = Object.assign(
	{ edges: true, dims: true, shadows: true, grid: false, ortho: false, props: true, quality: 'normal', density: '7.85', mode: 'real', meshUnit: 'mm' },
	safeJson(lsGet('mvSettings')));
function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeJson(s) { try { return JSON.parse(s) || {}; } catch { return {}; } }
function saveSettings() { try { localStorage.setItem('mvSettings', JSON.stringify(settings)); } catch { } }
let view2d = false; // открыт чертёж DXF/DWG: вид сверху, без вращения

// =====================================================================
// Сцена
// =====================================================================
const canvas = $('canvas');
const viewport = $('viewport');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, stencil: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.localClippingEnabled = true;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const persp = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
for (const c of [persp, ortho]) { c.up.set(0, 0, 1); c.position.set(1, -1, 1); }
let camera = settings.ortho ? ortho : persp;

const hemi = new THREE.HemisphereLight(0xffffff, 0x404650, 1.4);
hemi.position.set(0, 0, 1);
const headLight = new THREE.DirectionalLight(0xffffff, 1.8);
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(hemi, headLight, headLight.target, sun, sun.target);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.45 }));
ground.receiveShadow = true;
ground.raycast = () => { };
scene.add(ground);

const grid = new THREE.GridHelper(1, 10, 0x5a7090, 0x2c3a50);
grid.rotation.x = Math.PI / 2;
grid.material.transparent = true;
grid.material.opacity = 0.5;
grid.raycast = () => { };
scene.add(grid);

const modelRoot = new THREE.Group();
scene.add(modelRoot);

let tool = 'rotate';
let animating = false;
let controls = makeControls(camera);
function makeControls(cam) {
	const c = new OrbitControls(cam, canvas);
	c.enableRotate = !view2d;
	c.enableDamping = false;
	c.screenSpacePanning = true;
	c.zoomToCursor = true;
	c.rotateSpeed = 0.9;
	c.autoRotateSpeed = 2.5;
	c.addEventListener('change', requestRender);
	applyToolButtons(c);
	return c;
}

// сечение: общие для всех материалов
const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
const sectionUniform = { value: 0 };
const clipping = [];

// =====================================================================
// Рендер по требованию
// =====================================================================
let renderPending = false;
function requestRender() {
	if (!renderPending) { renderPending = true; requestAnimationFrame(render); }
}
function render() {
	renderPending = false;
	if (animating) { controls.update(); requestRender(); }
	const off = new THREE.Vector3(0.45, 0.6, 0).applyQuaternion(camera.quaternion);
	headLight.position.copy(camera.position).add(off.multiplyScalar(camera.position.distanceTo(controls.target) * 0.5));
	headLight.target.position.copy(controls.target);
	updateDims();
	renderer.render(scene, camera);
	updateViewCube();
	updateMeasureLabels();
}

function resize() {
	const w = viewport.clientWidth, h = viewport.clientHeight;
	if (!w || !h) return;
	renderer.setSize(w, h, false);
	persp.aspect = w / h;
	persp.updateProjectionMatrix();
	updateOrthoFrustum();
	requestRender();
}
new ResizeObserver(resize).observe(viewport);

let orthoHalf = 1;
function updateOrthoFrustum() {
	const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
	ortho.left = -orthoHalf * aspect; ortho.right = orthoHalf * aspect;
	ortho.top = orthoHalf; ortho.bottom = -orthoHalf;
	ortho.updateProjectionMatrix();
}

// =====================================================================
// Модель
// =====================================================================
const model = {
	name: '', buffer: null, ext: '', size: 0, format: '',
	object: null, meshes: [], box: new THREE.Box3(), radius: 1,
	triangles: 0, edgesBuilt: false, yUp: false, stats: null, thumb: '',
	is2d: false, info2d: null,
};

// ---- воркер OpenCascade ----
let worker = null;
let jobId = 0;
const jobs = new Map();
function startWorker() {
	worker = new Worker('occt-worker.js');
	worker.onmessage = (ev) => {
		const job = jobs.get(ev.data.id);
		if (!job) return;
		jobs.delete(ev.data.id);
		ev.data.error ? job.reject(new Error(ev.data.error)) : job.resolve(ev.data.result);
	};
}
startWorker();
// «Отмена»: разбор в OpenCascade не прерывается изнутри — останавливаем воркер целиком
function cancelLoad() {
	loadToken++;
	for (const j of jobs.values()) j.reject(new Error('cancel'));
	jobs.clear();
	worker.terminate();
	startWorker();
	hideLoading();
}
function occtParse(format, buffer, params) {
	return new Promise((resolve, reject) => {
		const id = ++jobId;
		jobs.set(id, { resolve, reject });
		const copy = buffer.slice(0);
		worker.postMessage({ id, format, buffer: copy, params }, [copy]);
	});
}

function occtToObject(res, name) {
	const meshes = res.meshes.map((m, i) => {
		const g = new THREE.BufferGeometry();
		const pos = m.attributes.position.array;
		g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
		if (m.attributes.normal) g.setAttribute('normal', new THREE.BufferAttribute(m.attributes.normal.array, 3));
		const idx = m.index ? m.index.array : null;
		if (idx) g.setIndex(new THREE.BufferAttribute(idx, 1));
		if (!m.attributes.normal) g.computeVertexNormals();

		const own = !!m.color;
		let base = own ? new THREE.Color().setRGB(m.color[0], m.color[1], m.color[2], THREE.SRGBColorSpace) : DEFAULT_COLOR;
		if (isDarkGrey(base)) base = DEFAULT_COLOR;
		const col = new Float32Array(pos.length);
		for (let k = 0; k < col.length; k += 3) { col[k] = base.r; col[k + 1] = base.g; col[k + 2] = base.b; }
		let faceColors = false;
		if (idx && m.brep_faces) {
			const c = new THREE.Color();
			for (const f of m.brep_faces) {
				if (!f.color) continue;
				faceColors = true;
				c.setRGB(f.color[0], f.color[1], f.color[2], THREE.SRGBColorSpace);
				if (isDarkGrey(c)) c.copy(DEFAULT_COLOR); // чёрная «бесцветная» грань -> сталь
				for (let t = f.first; t <= f.last; t++) {
					for (let j = 0; j < 3; j++) {
						const v = idx[t * 3 + j] * 3;
						col[v] = c.r; col[v + 1] = c.g; col[v + 2] = c.b;
					}
				}
			}
		}
		g.setAttribute('color', new THREE.BufferAttribute(col, 3));
		if (idx && m.brep_faces && m.brep_faces.length) {
			const faceOf = new Int32Array(idx.length / 3);
			m.brep_faces.forEach((f, fi) => faceOf.fill(fi, f.first, f.last + 1));
			g.userData.faceOf = faceOf;
			g.userData.faces = m.brep_faces.map((f) => ({ first: f.first, last: f.last }));
		}
		const mesh = new THREE.Mesh(g);
		mesh.name = m.name || `Тело ${i + 1}`;
		mesh.userData = { color: base.clone(), vertexColors: true, ownColor: own || faceColors };
		return mesh;
	});

	const build = (node, depth) => {
		const grp = new THREE.Group();
		grp.name = node.name || (depth === 0 ? name : 'Сборка');
		for (const mi of node.meshes || []) {
			const src = meshes[mi];
			let inst = src;
			if (src.parent) { inst = src.clone(); inst.userData = src.userData; }
			grp.add(inst);
		}
		for (const ch of node.children || []) grp.add(build(ch, depth + 1));
		return grp;
	};
	const root = build(res.root, 0);
	// убираем лишнюю обёртку «root → единственный узел»
	if (root.children.length === 1 && !root.children[0].isMesh && (!res.root.name)) {
		const only = root.children[0];
		only.name = only.name || name;
		return only;
	}
	return root;
}

function prepThreeObject(obj) {
	obj.traverse((o) => {
		if (!o.isMesh) return;
		const g = o.geometry;
		if (!g.attributes.normal) g.computeVertexNormals();
		const src = Array.isArray(o.material) ? o.material[0] : o.material;
		const vc = !!g.attributes.color;
		const color = (src && src.color && !vc) ? src.color.clone() : DEFAULT_COLOR.clone();
		o.userData = { color, vertexColors: vc, ownColor: !!(src && src.color) || vc, map: src && src.map || null };
		if (src) src.dispose();
	});
	return obj;
}

function geometryToObject(g, name) {
	if (!g.index && !g.attributes.normal && g.attributes.position.count % 3 !== 0) {
		const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: !!g.attributes.color, color: g.attributes.color ? 0xffffff : 0xbfc8d6, clippingPlanes: clipping }));
		pts.name = name;
		return pts;
	}
	if (!g.attributes.normal) g.computeVertexNormals();
	const m = new THREE.Mesh(g);
	m.name = name.replace(/\.[^.]+$/, '');
	m.userData = { color: DEFAULT_COLOR.clone(), vertexColors: !!g.attributes.color, ownColor: !!g.attributes.color };
	return m;
}

function detectFormat(ext, buffer) {
	const head = new TextDecoder('latin1').decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 8192)));
	if (ext === 'step' || ext === 'stp') {
		const m = head.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)/i);
		const s = m ? m[1].toUpperCase() : '';
		if (s.includes('AUTOMOTIVE_DESIGN')) return 'STEP (AP214)';
		if (s.includes('CONFIG_CONTROL_DESIGN')) return 'STEP (AP203)';
		if (s.includes('AP242')) return 'STEP (AP242)';
		return 'STEP';
	}
	if (ext === 'stl') return /^solid\s/i.test(head) && /facet/i.test(head) ? 'STL (ASCII)' : 'STL (двоичный)';
	if (ext === 'iges' || ext === 'igs') return 'IGES';
	if (ext === 'brep' || ext === 'brp') return 'BREP (OpenCascade)';
	return ext.toUpperCase();
}

async function parseModel(name, buffer) {
	const ext = name.split('.').pop().toLowerCase();
	if (DRAW_FORMATS[ext]) {
		const doc = await readDrawing(ext, buffer);
		const object = buildDrawing(doc, { fg: DRAW_FG });
		object.userData.formatName = drawingFormatName(doc);
		object.userData.info2d = { ...object.userData.stats2d, unitsName: doc.unitsName, scale: doc.scale, fileLayers: Object.keys(doc.layers).length };
		if (!object.children.length) throw new Error('В чертеже не найдено ни одного видимого объекта в пространстве модели.');
		return { object, yUp: false };
	}
	if (OCCT_FORMATS[ext]) {
		// повторное открытие того же файла — сетка из кэша, без OpenCascade
		const key = meshCacheKey(name, buffer);
		let res = await meshCacheGet(key);
		const cached = !!res;
		if (!res) {
			const q = QUALITY[settings.quality] || QUALITY.normal;
			res = await occtParse(OCCT_FORMATS[ext], buffer, {
				linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', ...q,
			});
			meshCachePut(key, res);
		}
		return { object: occtToObject(res, name), yUp: false, cached };
	}
	const r = await parseMeshFormat(ext, name, buffer);
	const k = MESH_UNITS[settings.meshUnit] || 1;
	if (k !== 1 && ext !== 'glb' && ext !== 'gltf' && ext !== '3mf') r.object.scale.multiplyScalar(k); // в 3MF единицы записаны в файле
	return r;
}
// 3MF: свой загрузчик (Bambu Studio, Orca, PrusaSlicer — детали в отдельных файлах архива);
// если он не справился — пробуем встроенный из three.js
function load3mf(buffer) {
	try { return parse3mf(buffer); }
	catch (e) {
		try { return new ThreeMFLoader().parse(buffer); } catch { throw e; }
	}
}
// единицы в файлах-сетках не записаны: по умолчанию миллиметры, можно сменить в «Свойствах»
const MESH_UNITS = { mm: 1, cm: 10, m: 1000, in: 25.4 };
const MESH_UNIT_NAMES = { mm: 'мм', cm: 'см', m: 'м', in: 'дюймы' };
async function parseMeshFormat(ext, name, buffer) {
	switch (ext) {
		case 'stl': return { object: geometryToObject(new STLLoader().parse(buffer), name), yUp: false };
		case 'ply': return { object: geometryToObject(new PLYLoader().parse(buffer), name), yUp: false };
		case 'obj': return { object: prepThreeObject(new OBJLoader().parse(new TextDecoder().decode(buffer))), yUp: true };
		case '3mf': return { object: prepThreeObject(load3mf(buffer)), yUp: false };
		case 'glb': case 'gltf': {
			const gltf = await new Promise((res, rej) => new GLTFLoader().parse(buffer, '', res, rej));
			return { object: prepThreeObject(gltf.scene), yUp: true };
		}
	}
	throw new Error('Неподдерживаемый формат: .' + ext);
}

// =====================================================================
// Загрузка
// =====================================================================
let loadToken = 0;
// файлы открываются строго по очереди (несколько сразу — каждый своей вкладкой)
let openChain = Promise.resolve();
function openBuffer(name, buffer, opts = {}) {
	openChain = openChain.then(() => openBufferNow(name, buffer, opts)).catch(() => { });
	return openChain;
}
async function openBufferNow(name, buffer, opts) {
	const ext = name.split('.').pop().toLowerCase();
	if (!SUPPORTED.includes(ext)) { alert('Формат .' + ext + ' не поддерживается'); return; }
	const token = ++loadToken;
	const t0 = performance.now();
	showLoading(`Открываю ${name}…`, true);
	const timer = setInterval(() => {
		$('loadingText').textContent = `Открываю ${name}… ${((performance.now() - t0) / 1000).toFixed(1)} с`;
	}, 200);
	try {
		const { object, yUp, cached } = await parseModel(name, buffer);
		if (token !== loadToken) { disposeObject(object); return; }
		if (opts.replace && activeDoc >= 0) {
			// та же вкладка (например, сменили точность) — старая модель удаляется в setModel
		} else {
			exitCompare();
			saveActiveDoc();
			if (model.object) { clearMeasure(); select(null); modelRoot.remove(model.object); }
			model.object = null;
			docs.push({});
			activeDoc = docs.length - 1;
		}
		Object.assign(model, { name, buffer, ext, size: buffer.byteLength, format: object.userData.formatName || detectFormat(ext, buffer) });
		model.loadTime = (performance.now() - t0) / 1000;
		model.cached = !!cached;
		object.name = object.name || name;
		setModel(object, yUp);
		docs[activeDoc] = snapshotDoc();
		setWindowTitle();
		renderTabs();
		if (!opts.noRecent) saveRecent();
	} catch (e) {
		if (e && e.message === 'cancel') return;
		console.error(e);
		if (token === loadToken) alert('Не удалось открыть файл:\n' + (e.message || e));
	} finally {
		clearInterval(timer);
		if (token === loadToken) hideLoading();
	}
}

function disposeObject(obj) {
	obj.traverse((o) => {
		if (o.geometry) o.geometry.dispose();
		if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
	});
}

function setModel(object, yUp) {
	exitCompare();
	model.tech = null;
	$('techDlg').hidden = true;
	clearMeasure();
	if (model.object) { modelRoot.remove(model.object); disposeObject(model.object); }
	model.object = object;
	model.edgesBuilt = false;
	model.yUp = yUp;
	model.is2d = !!object.userData.drawing;
	model.info2d = object.userData.info2d || null;
	modelRoot.add(object);
	applyUpAxis();
	apply2d();

	model.meshes = [];
	model.triangles = 0;
	object.traverse((o) => {
		if (model.is2d) { if (o.geometry) model.meshes.push(o); return; }
		if (o.isMesh) {
			model.meshes.push(o);
			o.castShadow = true;
			const g = o.geometry;
			model.triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
		} else if (o.isPoints) model.meshes.push(o);
	});

	if (settings.edges && model.triangles > EDGE_AUTO_LIMIT) { settings.edges = false; syncControls(); }
	selected = null;
	applyMode();
	buildTree();
	updateBounds();
	computeStats();
	$('welcome').classList.add('hidden');
	setView(model.is2d ? 'top' : 'iso');
	if (sectionOn) { refreshCaps(); setupSection(); }
	makeThumb();
	updateProps();
	updateCard();
}

function applyUpAxis() {
	modelRoot.rotation.set(model.yUp ? Math.PI / 2 : 0, 0, 0);
	modelRoot.updateMatrixWorld(true);
	$('optYUp').checked = model.yUp;
}

function isShown(o) {
	while (o) { if (!o.visible) return false; o = o.parent; }
	return true;
}

function updateBounds() {
	modelRoot.updateMatrixWorld(true);
	model.box.makeEmpty();
	for (const m of model.meshes) if (isShown(m)) model.box.expandByObject(m);
	if (model.box.isEmpty()) model.box.set(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
	const size = model.box.getSize(new THREE.Vector3());
	const c = model.box.getCenter(new THREE.Vector3());
	model.radius = Math.max(1e-6, size.length() / 2);
	const R = model.radius;

	// сетка и тень на полу
	const step = niceStep(Math.max(size.x, size.y) / 6);
	const n = Math.max(10, Math.ceil(R * 4 / step / 2) * 2);
	grid.geometry.dispose();
	grid.geometry = new THREE.GridHelper(n * step, n).geometry;
	grid.material.vertexColors = true;
	const z0 = model.box.min.z - R * 0.002;
	grid.position.set(c.x, c.y, z0);
	ground.scale.set(R * 8, R * 8, 1);
	ground.position.set(c.x, c.y, z0);

	sun.position.set(c.x + R * 0.8, c.y - R * 1.2, c.z + R * 2.5);
	sun.target.position.copy(c);
	const sc = sun.shadow.camera;
	sc.left = -R * 1.6; sc.right = R * 1.6; sc.top = R * 1.6; sc.bottom = -R * 1.6;
	sc.near = R * 0.1; sc.far = R * 6;
	sc.updateProjectionMatrix();
	requestRender();
}

// =====================================================================
// Режимы отображения
// =====================================================================
function patchSection(m) {
	m.onBeforeCompile = (sh) => {
		sh.uniforms.uSection = sectionUniform;
		sh.fragmentShader = 'uniform float uSection;\n' + sh.fragmentShader.replace(
			'#include <dithering_fragment>',
			'#include <dithering_fragment>\nif (uSection > 0.5 && !gl_FrontFacing) gl_FragColor.rgb = vec3(0.16, 0.45, 1.0) * (0.55 + 0.45 * gl_FragColor.a);');
	};
	return m;
}

function makeMaterial(mesh, mode) {
	const ud = mesh.userData;
	const common = { side: THREE.DoubleSide, clippingPlanes: clipping, clipShadows: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 };
	const vc = !!ud.vertexColors;
	const color = vc ? new THREE.Color(0xffffff) : (ud.color || DEFAULT_COLOR).clone();
	let m;
	switch (mode) {
		case 'real': {
			// ненасыщенные (серые/белые) детали показываем как сталь
			const hsl = (ud.color || DEFAULT_COLOR).getHSL({});
			const metal = hsl.s < 0.15 && !ud.map;
			if (metal && !vc && hsl.l < 0.3) color.copy(DEFAULT_COLOR); // чёрный «бесцветный» -> сталь
			m = new THREE.MeshStandardMaterial({
				...common, color: metal ? (vc ? new THREE.Color(0xb4b9c0) : color.clone().multiplyScalar(0.8)) : color,
				vertexColors: vc, map: ud.map || null,
				metalness: metal ? 0.92 : 0.2, roughness: metal ? 0.26 : 0.45, envMapIntensity: metal ? 1.3 : 0.75,
			});
			break;
		}
		case 'shaded':
			m = new THREE.MeshPhongMaterial({ ...common, color, vertexColors: vc, map: ud.map || null, shininess: 40, specular: 0x262626 });
			break;
		case 'hidden':
			m = new THREE.MeshBasicMaterial({ ...common, color: 0xe8ecf2 });
			break;
		case 'wire':
			m = new THREE.MeshBasicMaterial({ ...common, color: 0x8fb6ff, wireframe: true, transparent: true, opacity: 0.55 });
			break;
		case 'xray':
			m = new THREE.MeshBasicMaterial({ ...common, color: 0x2f7bff, transparent: true, opacity: 0.08, depthWrite: false, blending: THREE.AdditiveBlending });
			break;
	}
	m.userData.baseColor = m.color.clone();
	return patchSection(m);
}

const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x0e1117, transparent: true, opacity: 0.8, clippingPlanes: clipping });
const EDGE_STYLE = {
	real: [0x0b0e14, 0.55], shaded: [0x0e1117, 0.85], hidden: [0x10141c, 1], xray: [0x6ea8ff, 0.75], wire: [0x8fb6ff, 0],
};

function applyMode() {
	const mode = settings.mode;
	$$('#modes .mode').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
	const real = mode === 'real';
	scene.environment = real ? envMap : null;
	renderer.toneMapping = real ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
	renderer.toneMappingExposure = 0.9;
	hemi.intensity = real ? 0.5 : 1.4;
	headLight.intensity = real ? 1.1 : 1.8;
	sun.visible = real;
	sun.castShadow = real && settings.shadows && !model.is2d;
	ground.visible = real && settings.shadows && !model.is2d;
	grid.visible = settings.grid;

	for (const m of model.meshes) {
		if (!m.isMesh || model.is2d) continue;
		if (m.material) m.material.dispose();
		m.material = makeMaterial(m, mode);
		m.castShadow = real;
		m.renderOrder = mode === 'xray' ? 1 : 0;
	}
	const [ec, eo] = EDGE_STYLE[mode];
	edgeMaterial.color.setHex(ec);
	edgeMaterial.opacity = eo;
	edgeMaterial.depthTest = mode !== 'xray';
	const wantEdges = !model.is2d && (mode === 'hidden' || mode === 'xray' || (settings.edges && mode !== 'wire'));
	if (wantEdges && model.object) ensureEdges(); else setEdgesVisible(false);
	if (selected) highlight(selected.obj, true);
	if (sectionOn) { refreshCaps(); setupSection(); }
	requestRender();
}

function ensureEdges() {
	if (!model.edgesBuilt) {
		for (const m of model.meshes) {
			if (!m.isMesh) continue;
			const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 25), edgeMaterial);
			e.name = '__edges'; e.raycast = () => { };
			m.add(e);
		}
		model.edgesBuilt = true;
	}
	setEdgesVisible(true);
}
function setEdgesVisible(v) {
	for (const m of model.meshes) for (const ch of m.children) if (ch.name === '__edges') ch.visible = v;
}

// =====================================================================
// Камера и виды
// =====================================================================
const VIEWS = {
	front: [0, -1, 0], back: [0, 1, 0], left: [-1, 0, 0], right: [1, 0, 0],
	top: [0, -1e-4, 1], bottom: [0, -1e-4, -1], iso: [1, -1.15, 0.75],
};
function setView(name) {
	if (model.is2d) name = 'top'; // чертёж смотрим только сверху
	fitTo(model.box, new THREE.Vector3(...VIEWS[name]).normalize());
}
function fitTo(box, dir) {
	const sphere = box.getBoundingSphere(new THREE.Sphere());
	const r = Math.max(sphere.radius, 1e-6);
	dir = dir || camera.position.clone().sub(controls.target).normalize();
	const fov = THREE.MathUtils.degToRad(persp.fov);
	const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
	const fit = Math.min(Math.tan(fov / 2), Math.tan(fov / 2) * aspect);
	const k = settings.dims ? 1.3 : 1.1; // запас под размерные линии и нижнюю панель
	const dist = r / Math.sin(Math.atan(fit)) * k;
	const R = model.radius;
	for (const c of [persp, ortho]) {
		c.position.copy(sphere.center).addScaledVector(dir, dist);
		c.near = Math.max(R * 1e-3, 1e-5);
		c.far = dist + R * 50;
		c.zoom = 1;
	}
	ortho.near = -R * 50;
	orthoHalf = r * k / Math.min(1, aspect);
	if (view2d) {
		// чертёж: вписываем прямоугольник габарита, а не описанную сферу
		const sz = box.getSize(new THREE.Vector3());
		orthoHalf = Math.max(sz.y / 2, sz.x / 2 / aspect, 1e-6) * 1.08;
	}
	updateOrthoFrustum();
	persp.updateProjectionMatrix();
	controls.target.copy(sphere.center);
	camera.lookAt(sphere.center);
	controls.update();
	requestRender();
}

function setOrtho(on) {
	settings.ortho = on; saveSettings(); syncControls();
	useCamera(on || model.is2d);
}
function useCamera(on) {
	const from = camera, to = on ? ortho : persp;
	if (from === to) return;
	const target = controls.target.clone();
	to.position.copy(from.position);
	to.quaternion.copy(from.quaternion);
	const dist = from.position.distanceTo(target);
	const fov = THREE.MathUtils.degToRad(persp.fov);
	if (on) {
		orthoHalf = dist * Math.tan(fov / 2) / (from.zoom || 1);
		ortho.zoom = 1;
		updateOrthoFrustum();
	} else {
		const d = (orthoHalf / ortho.zoom) / Math.tan(fov / 2);
		persp.position.copy(target).addScaledVector(from.position.clone().sub(target).normalize(), d);
		persp.zoom = 1;
		persp.updateProjectionMatrix();
	}
	camera = to;
	controls.dispose();
	controls = makeControls(camera);
	controls.target.copy(target);
	controls.autoRotate = animating;
	controls.update();
	requestRender();
}

// ---- куб видов ----
const vcCube = $('vcCube');
function updateViewCube() {
	camera.updateMatrixWorld();
	const e = camera.matrixWorldInverse.elements;
	vcCube.style.transform = `translateZ(-120px) matrix3d(${e[0]},${-e[1]},${e[2]},0,${e[4]},${-e[5]},${e[6]},0,${e[8]},${-e[9]},${e[10]},0,0,0,0,1)`;
}
$$('.vc-face').forEach((f) => f.addEventListener('click', () => model.object && setView(f.dataset.face)));
$('vcIso').onclick = () => model.object && setView('iso');

// =====================================================================
// Размерные линии
// =====================================================================
const dimGeom = new THREE.BufferGeometry();
dimGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9 * 2 * 3), 3));
const dimLines = new THREE.LineSegments(dimGeom, new THREE.LineBasicMaterial({ color: 0xe4ebf5, transparent: true, opacity: 0.8, depthTest: false }));
dimLines.renderOrder = 997;
dimLines.frustumCulled = false;
dimLines.raycast = () => { };
scene.add(dimLines);
const dimLabels = [0, 1, 2].map(() => {
	const el = document.createElement('div');
	el.className = 'dimlabel';
	$('labels').append(el);
	return { el, pos: new THREE.Vector3() };
});

function updateDims() {
	const show = settings.dims && !!model.object && !model.is2d;
	dimLines.visible = show;
	dimLabels.forEach((l) => l.el.style.display = show ? '' : 'none');
	if (!show) return;
	const b = model.box, mn = b.min, mx = b.max;
	const c = b.getCenter(new THREE.Vector3());
	const s = b.getSize(new THREE.Vector3());
	const off = Math.max(s.x, s.y, s.z) * 0.1;
	const cam = camera.position;
	const sy = cam.y < c.y ? -1 : 1, sx = cam.x < c.x ? -1 : 1;
	const yE = sy < 0 ? mn.y : mx.y, xE = sx < 0 ? mn.x : mx.x;
	const yF = sy < 0 ? mx.y : mn.y;
	const yL = yE + sy * off, xL = xE + sx * off, z0 = mn.z;
	const ex = off * 0.25;
	const p = dimGeom.attributes.position.array;
	let i = 0;
	const seg = (a, bb) => { p.set(a, i); p.set(bb, i + 3); i += 6; };
	// X
	seg([mn.x, yL, z0], [mx.x, yL, z0]);
	seg([mn.x, yE, z0], [mn.x, yL + sy * ex, z0]);
	seg([mx.x, yE, z0], [mx.x, yL + sy * ex, z0]);
	// Y
	seg([xL, mn.y, z0], [xL, mx.y, z0]);
	seg([xE, mn.y, z0], [xL + sx * ex, mn.y, z0]);
	seg([xE, mx.y, z0], [xL + sx * ex, mx.y, z0]);
	// Z (вертикаль на дальнем углу со стороны камеры по X)
	seg([xL, yF, mn.z], [xL, yF, mx.z]);
	seg([xE, yF, mn.z], [xL + sx * ex, yF, mn.z]);
	seg([xE, yF, mx.z], [xL + sx * ex, yF, mx.z]);
	dimGeom.attributes.position.needsUpdate = true;

	dimLabels[0].pos.set(c.x, yL + sy * off * 0.45, z0); dimLabels[0].el.textContent = fix2(s.x);
	dimLabels[1].pos.set(xL + sx * off * 0.45, c.y, z0); dimLabels[1].el.textContent = fix2(s.y);
	dimLabels[2].pos.set(xL + sx * off * 0.45, yF, c.z); dimLabels[2].el.textContent = fix2(s.z);
	const w = canvas.clientWidth, h = canvas.clientHeight;
	camera.updateMatrixWorld();
	for (const l of dimLabels) {
		const q = l.pos.clone().project(camera);
		l.el.style.left = (q.x * 0.5 + 0.5) * w + 'px';
		l.el.style.top = (-q.y * 0.5 + 0.5) * h + 'px';
	}
}

// =====================================================================
// Статистика: объём, площадь, центр масс
// =====================================================================
function meshStats(mesh, toModel) {
	const g = mesh.geometry;
	const pos = g.attributes.position;
	const idx = g.index ? g.index.array : null;
	const n = idx ? idx.length : pos.count;
	const M = new THREE.Matrix4().multiplyMatrices(toModel, mesh.matrixWorld);
	const e = M.elements;
	const P = pos.array;
	let vol = 0, area = 0, cx = 0, cy = 0, cz = 0;
	const tx = (k) => e[0] * P[k] + e[4] * P[k + 1] + e[8] * P[k + 2] + e[12];
	const ty = (k) => e[1] * P[k] + e[5] * P[k + 1] + e[9] * P[k + 2] + e[13];
	const tz = (k) => e[2] * P[k] + e[6] * P[k + 1] + e[10] * P[k + 2] + e[14];
	for (let t = 0; t < n; t += 3) {
		const a = (idx ? idx[t] : t) * 3, b = (idx ? idx[t + 1] : t + 1) * 3, c = (idx ? idx[t + 2] : t + 2) * 3;
		const ax = tx(a), ay = ty(a), az = tz(a);
		const bx = tx(b), by = ty(b), bz = tz(b);
		const qx = tx(c), qy = ty(c), qz = tz(c);
		const v = (ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx)) / 6;
		vol += v;
		cx += v * (ax + bx + qx) / 4; cy += v * (ay + by + qy) / 4; cz += v * (az + bz + qz) / 4;
		const ux = bx - ax, uy = by - ay, uz = bz - az, wx = qx - ax, wy = qy - ay, wz = qz - az;
		const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
		area += Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
	}
	return { vol, area, cx, cy, cz };
}

function statsFor(obj) {
	modelRoot.updateMatrixWorld(true);
	const toModel = new THREE.Matrix4().copy(modelRoot.matrixWorld).invert();
	if (model.is2d) {
		// чертёж: только габарит и число линий
		const box = new THREE.Box3();
		let segs = 0;
		obj.traverse((o) => {
			if (!o.geometry || !isShown(o)) return;
			if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
			box.union(o.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(toModel, o.matrixWorld)));
			if (o.isLineSegments) segs += o.geometry.attributes.position.count / 2;
		});
		if (box.isEmpty()) box.set(new THREE.Vector3(), new THREE.Vector3());
		return { vol: 0, area: 0, com: box.getCenter(new THREE.Vector3()), tris: 0, bodies: 0, box, size: box.getSize(new THREE.Vector3()), closed: false, segs };
	}
	let vol = 0, area = 0, cx = 0, cy = 0, cz = 0, tris = 0, bodies = 0;
	const box = new THREE.Box3();
	obj.traverse((o) => {
		if (!o.isMesh || !isShown(o)) return;
		const s = meshStats(o, toModel);
		// у тела с вывернутыми нормалями объём отрицательный — берём модуль
		const sg = s.vol < 0 ? -1 : 1;
		vol += s.vol * sg; cx += s.cx * sg; cy += s.cy * sg; cz += s.cz * sg;
		area += s.area;
		bodies++;
		const g = o.geometry;
		tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
		const bb = new THREE.Box3().setFromBufferAttribute(g.attributes.position)
			.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toModel, o.matrixWorld));
		box.union(bb);
	});
	const com = vol > 1e-12 ? new THREE.Vector3(cx / vol, cy / vol, cz / vol) : box.getCenter(new THREE.Vector3());
	return { vol, area, com, tris, bodies, box, size: box.getSize(new THREE.Vector3()), closed: vol > 1e-12 };
}

function computeStats() {
	model.stats = model.object ? statsFor(model.object) : null;
}

// =====================================================================
// Дерево
// =====================================================================
let selected = null;
const rowOf = new Map();
function buildTree() {
	const body = $('treeBody');
	body.innerHTML = '';
	rowOf.clear();
	$('treeTitle').textContent = model.name || 'Нет модели';
	if (!model.object) return;
	const hasMesh = (o) => { let f = false; o.traverse((c) => { if (c.isMesh || c.isPoints || c.isLineSegments) f = true; }); return f; };
	let count = 0;
	const add = (obj, parentEl, depth) => {
		if (count++ > 6000) return;
		// у чертежа в дереве только слои (линии и надписи внутри слоя не показываем)
		const kids = obj.userData.dxfLayer ? [] : obj.children.filter((c) => c.name !== '__edges' && hasMesh(c));
		const row = document.createElement('div');
		row.className = 'node';
		row.style.paddingLeft = 4 + depth * 14 + 'px';
		const open = depth < 1;
		row.innerHTML =
			`<span class="tw ${kids.length && open ? 'open' : ''}">${kids.length ? icon('chevRight') : ''}</span>` +
			`<i class="ic">${icon(obj.userData.dxfLayer ? 'dims' : kids.length || !(obj.isMesh || obj.isPoints) ? 'assembly' : 'part')}</i>` +
			`<span class="nm"></span>` +
			`<button class="eye" title="Показать/скрыть">${icon('eye')}</button>`;
		row.querySelector('.ic').style.display = 'inline-flex';
		const nm = row.querySelector('.nm');
		nm.textContent = obj.name || (obj.isMesh ? 'Тело' : 'Сборка');
		nm.title = nm.textContent;
		parentEl.append(row);
		row._obj = obj;
		rowOf.set(obj, row);

		row.querySelector('.eye').addEventListener('click', (e) => {
			e.stopPropagation();
			setVisible(obj, !obj.visible);
		});
		row.addEventListener('click', () => select(obj));
		row.addEventListener('dblclick', () => {
			const b = new THREE.Box3().setFromObject(obj);
			if (!b.isEmpty()) fitTo(b);
		});
		if (kids.length) {
			const box = document.createElement('div');
			box.className = 'children' + (open ? '' : ' collapsed');
			parentEl.append(box);
			const tw = row.querySelector('.tw');
			tw.addEventListener('click', (e) => {
				e.stopPropagation();
				box.classList.toggle('collapsed');
				tw.classList.toggle('open', !box.classList.contains('collapsed'));
			});
			for (const k of kids) add(k, box, depth + 1);
		}
	};
	add(model.object, body, 0);
}
$('treeCollapse').onclick = () => {
	$$('#treeBody .children').forEach((c, i) => c.classList.toggle('collapsed', i > 0));
	$$('#treeBody .tw').forEach((t, i) => t.classList.toggle('open', i === 0 && t.innerHTML !== ''));
};

function setVisible(obj, v) {
	obj.visible = v;
	if (sectionOn) refreshCaps();
	const row = rowOf.get(obj);
	if (row) {
		row.classList.toggle('off', !v);
		row.querySelector('.eye').innerHTML = icon(v ? 'eye' : 'eyeOff');
	}
	updateBounds();
	computeStats();
	updateProps();
	requestRender();
}
$('qShowAll').onclick = () => {
	if (!model.object) return;
	model.object.traverse((o) => { if (o.name !== '__edges' && !o.visible) { o.visible = true; const r = rowOf.get(o); if (r) { r.classList.remove('off'); r.querySelector('.eye').innerHTML = icon('eye'); } } });
	updateBounds(); computeStats(); updateProps(); requestRender();
};

const HILITE = new THREE.Color(0xff9a1f);
function highlight(obj, on) {
	obj.traverse((o) => {
		if (o.userData.dxfLine) { o.material.color.copy(on ? HILITE : o.material.userData.baseColor); return; }
		if (!o.isMesh || o.userData.dxfText || o.userData.dxfFill) return;
		const m = o.material;
		if (m.emissive) m.emissive.copy(on ? HILITE : new THREE.Color(0)).multiplyScalar(on ? 0.4 : 0);
		else if (m.userData.baseColor) m.color.copy(on ? HILITE : m.userData.baseColor);
	});
}
function select(obj) {
	if (selected) {
		highlight(selected.obj, false);
		const r = rowOf.get(selected.obj); if (r) r.classList.remove('sel');
	}
	if (!obj || (selected && selected.obj === obj)) { selected = null; updateProps(); updateTechTarget(); requestRender(); return; }
	selected = { obj, stats: statsFor(obj) };
	highlight(obj, true);
	const row = rowOf.get(obj);
	if (row) {
		row.classList.add('sel');
		let p = row.parentElement;
		while (p && p.id !== 'treeBody') {
			if (p.classList.contains('children') && p.classList.contains('collapsed')) {
				p.classList.remove('collapsed');
				const tw = p.previousElementSibling && p.previousElementSibling.querySelector('.tw');
				if (tw) tw.classList.add('open');
			}
			p = p.parentElement;
		}
		row.scrollIntoView({ block: 'nearest' });
	}
	updateProps();
	updateTechTarget();
	requestRender();
}

// =====================================================================
// Панель свойств
// =====================================================================
function kv(rows) {
	return rows.map(([k, v]) => `<span>${esc(k)}</span><span>${esc(v)}</span>`).join('');
}
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
let propsText = '';
function updateProps() {
	if (!model.object || !model.stats) {
		$('pModel').innerHTML = '<div class="muted">Нет модели</div>';
		$('pCom').innerHTML = $('pRange').innerHTML = $('pMaterial').innerHTML = $('pAnalysis').innerHTML = '';
		$('analysisBody').innerHTML = '<div class="muted">Нет модели</div>';
		return;
	}
	const st = selected ? selected.stats : model.stats;
	$('pComTitle').textContent = model.is2d ? 'Центр габарита' : 'Центр масс';
	if (model.is2d) { updateProps2d(st); return; }
	const dens = parseFloat(settings.density) || 7.85;
	const parts = countParts();
	const S = st.size;
	const modelRows = [
		['Имя:', selected ? (selected.obj.name || 'Тело') : model.name],
		['Формат:', model.format + (OCCT_FORMATS[model.ext] || model.ext === 'glb' || model.ext === 'gltf' ? '' : ', единицы: ' + MESH_UNIT_NAMES[settings.meshUnit])],
		['Размер:', fmtSize(model.size)],
		['Деталей:', String(selected ? countLeaves(selected.obj) : parts.parts)],
		['Тела:', String(st.bodies)],
		['Габариты:', `${fix2(S.x)} x ${fix2(S.y)} x ${fix2(S.z)} мм`],
	];
	$('pModel').innerHTML = kv(modelRows);
	$('pCom').innerHTML = kv([['X:', fix2(st.com.x) + ' мм'], ['Y:', fix2(st.com.y) + ' мм'], ['Z:', fix2(st.com.z) + ' мм']]);
	$('pRange').innerHTML = kv([['X:', fix2(S.x) + ' мм'], ['Y:', fix2(S.y) + ' мм'], ['Z:', fix2(S.z) + ' мм']]);

	const volCm3 = st.vol / 1000;
	const mass = volCm3 * dens / 1000;
	const densName = $('density').selectedOptions[0].textContent.split('—')[0].trim();
	const matRows = [
		['Материал:', densName],
		['Плотность:', fmtNum(dens, 3) + ' г/см³'],
		['Объём:', st.closed ? fmtNum(volCm3, 3) + ' см³' : 'тело не замкнуто'],
		['Масса:', st.closed ? fmtMass(mass) : '—'],
	];
	if (selected && selected.obj.isMesh) matRows.unshift(['Цвет:', '#' + (selected.obj.userData.color || DEFAULT_COLOR).getHexString(THREE.SRGBColorSpace)]);
	$('pMaterial').innerHTML = kv(matRows) + '<div class="muted small" style="grid-column:1/-1;margin-top:8px">Материал меняется в разделе «Свойства» слева.</div>';

	const anRows = [
		['Объём:', st.closed ? fmtNum(volCm3, 3) + ' см³' : '—'],
		['Площадь:', fmtNum(st.area / 100, 2) + ' см²'],
		['Масса:', st.closed ? fmtMass(mass) : '—'],
		['Треугольников:', fmtInt(Math.round(st.tris))],
		['Min:', `${fix2(st.box.min.x)}; ${fix2(st.box.min.y)}; ${fix2(st.box.min.z)}`],
		['Max:', `${fix2(st.box.max.x)}; ${fix2(st.box.max.y)}; ${fix2(st.box.max.z)}`],
		['Открыт за:', model.loadTime ? model.loadTime.toFixed(2) + ' с' + (model.cached ? ' (из кэша)' : '') : '—'],
	];
	$('pAnalysis').innerHTML = kv(anRows);
	$('analysisBody').innerHTML = kv(anRows);

	propsText = [...modelRows, ['Центр масс:', `${fix2(st.com.x)}; ${fix2(st.com.y)}; ${fix2(st.com.z)} мм`], ...matRows.slice(-2), ['Площадь:', fmtNum(st.area / 100, 2) + ' см²']]
		.map(([k, v]) => `${k} ${v}`).join('\n');
}
function updateProps2d(st) {
	const S = st.size, I = model.info2d || {};
	const modelRows = [
		['Имя:', selected ? (selected.obj.name || 'Слой') : model.name],
		['Формат:', model.format],
		['Единицы файла:', I.unitsName || '—'],
		['Размер:', fmtSize(model.size)],
		[selected ? 'Слой:' : 'Слоёв:', selected ? (selected.obj.name || '0') : String(I.layers || 0)],
		['Габариты:', `${fix2(S.x)} x ${fix2(S.y)} мм`],
	];
	$('pModel').innerHTML = kv(modelRows);
	$('pCom').innerHTML = kv([['Центр X:', fix2(st.com.x) + ' мм'], ['Центр Y:', fix2(st.com.y) + ' мм']]);
	$('pRange').innerHTML = kv([['X:', fix2(S.x) + ' мм'], ['Y:', fix2(S.y) + ' мм']]);
	$('pMaterial').innerHTML = '<div class="muted small" style="grid-column:1/-1">Чертёж 2D — объём и масса не считаются.</div>';
	const anRows = [
		['Объектов:', fmtInt(I.entities || 0)],
		['Надписей:', fmtInt(I.texts || 0) + (I.skippedTexts ? ` (+${fmtInt(I.skippedTexts)} не показано)` : '')],
		['Отрезков:', fmtInt(Math.round(st.segs || 0))],
		['Min:', `${fix2(st.box.min.x)}; ${fix2(st.box.min.y)}`],
		['Max:', `${fix2(st.box.max.x)}; ${fix2(st.box.max.y)}`],
		['Открыт за:', model.loadTime ? model.loadTime.toFixed(2) + ' с' : '—'],
	];
	$('pAnalysis').innerHTML = kv(anRows);
	$('analysisBody').innerHTML = kv(anRows);
	propsText = [...modelRows, ...anRows.slice(0, 2)].map(([k, v]) => `${k} ${v}`).join('\n');
}
function countLeaves(obj) { let n = 0; obj.traverse((o) => { if (o.isMesh || o.isPoints || o.userData.dxfLayer) n++; }); return n; }
function countParts() { return { parts: countLeaves(model.object) }; }

$$('#propTabs button').forEach((b) => b.onclick = () => {
	$$('#propTabs button').forEach((x) => x.classList.toggle('on', x === b));
	$$('#props .tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === b.dataset.tab));
});
$('propsCopy').onclick = async () => {
	if (!propsText) return;
	try { await navigator.clipboard.writeText(propsText); flash($('propsCopy'), 'Скопировано'); } catch { }
};
function flash(btn, text) {
	const old = btn.innerHTML;
	btn.innerHTML = text;
	setTimeout(() => { btn.innerHTML = old; }, 1200);
}
$('propsClose').onclick = () => toggleProps(false);
$('qProps').onclick = () => toggleProps(!settings.props);
function toggleProps(v) {
	settings.props = v; saveSettings();
	$('app').classList.toggle('no-props', !v);
	$('qProps').classList.toggle('on', v);
}

// ---- карточка превью ----
function makeThumb() {
	render();
	try {
		const src = canvas;
		const w = 320, h = Math.round(320 * src.height / src.width);
		const c = document.createElement('canvas');
		c.width = w; c.height = h;
		c.getContext('2d').drawImage(src, 0, 0, w, h);
		model.thumb = c.toDataURL('image/webp', 0.85);
	} catch { model.thumb = ''; }
}
function updateCard() {
	if (!model.object) { $('card').hidden = true; return; }
	$('card').hidden = false;
	$('cardImg').src = model.thumb;
	$('cardName').textContent = model.name;
	const S = model.stats.size;
	$('cardInfo').innerHTML = model.is2d
		? `Тип: ${esc(model.format.split(' ')[0])} (чертёж)<br>Размер: ${fmtSize(model.size)}<br>Слоёв: ${(model.info2d || {}).layers || 0}<br>Габариты: ${fmtNum(S.x, 1)} x ${fmtNum(S.y, 1)} мм`
		: `Тип: ${esc(model.format.split(' ')[0])}<br>Размер: ${fmtSize(model.size)}<br>Деталей: ${countParts().parts}<br>Габариты: ${fmtNum(S.x, 1)} x ${fmtNum(S.y, 1)} x ${fmtNum(S.z, 1)} мм`;
	refreshFavButton();
}

// =====================================================================
// Вкладки: несколько моделей в одном окне
// =====================================================================
const docs = [];
let activeDoc = -1;
const DOC_KEYS = ['name', 'buffer', 'ext', 'size', 'format', 'object', 'meshes', 'radius', 'triangles',
	'edgesBuilt', 'yUp', 'stats', 'thumb', 'loadTime', 'cached', 'tech', 'is2d', 'info2d'];

function snapshotDoc() {
	const d = {};
	for (const k of DOC_KEYS) d[k] = model[k];
	d.box = model.box.clone();
	d.cam = { pos: camera.position.clone(), target: controls.target.clone(), orthoHalf, zoom: camera.zoom };
	return d;
}
function saveActiveDoc() { if (activeDoc >= 0 && model.object) docs[activeDoc] = snapshotDoc(); }

function setWindowTitle() {
	document.title = (model.name ? model.name + ' — ' : '') + APP_TITLE;
	if (window.pywebview && window.pywebview.api) window.pywebview.api.set_title(document.title);
}

function loadDoc(i) {
	const d = docs[i];
	activeDoc = i;
	for (const k of DOC_KEYS) model[k] = d[k];
	model.box.copy(d.box);
	modelRoot.add(model.object);
	applyUpAxis();
	apply2d();
	applyMode();
	buildTree();
	updateBounds();
	$('welcome').classList.add('hidden');
	// камера — как была на этой вкладке
	const R = model.radius;
	for (const c of [persp, ortho]) { c.near = Math.max(R * 1e-3, 1e-5); c.far = d.cam.pos.distanceTo(d.cam.target) + R * 50; }
	ortho.near = -R * 50;
	camera.position.copy(d.cam.pos);
	controls.target.copy(d.cam.target);
	orthoHalf = d.cam.orthoHalf;
	camera.zoom = d.cam.zoom;
	updateOrthoFrustum();
	persp.updateProjectionMatrix();
	controls.update();
	if (sectionOn) { refreshCaps(); setupSection(); }
	updateProps();
	updateCard();
	setWindowTitle();
	renderTabs();
	requestRender();
}

function switchDoc(i) {
	if (i === activeDoc || !docs[i]) return;
	exitCompare();
	saveActiveDoc();
	clearMeasure();
	select(null);
	if (model.object) modelRoot.remove(model.object);
	loadDoc(i);
}

function closeDoc(i) {
	if (!docs[i]) return;
	if (compareState && (i === activeDoc || docs[i] === compareState.B)) exitCompare();
	if (i === activeDoc) {
		clearMeasure();
		select(null);
		if (model.object) { modelRoot.remove(model.object); disposeObject(model.object); }
		docs.splice(i, 1);
		activeDoc = -1;
		model.object = null;
		if (docs.length) loadDoc(Math.min(i, docs.length - 1));
		else showEmpty();
	} else {
		disposeObject(docs[i].object);
		docs.splice(i, 1);
		if (i < activeDoc) activeDoc--;
	}
	renderTabs();
}

function showEmpty() {
	Object.assign(model, { name: '', buffer: null, ext: '', size: 0, format: '', object: null, meshes: [], triangles: 0, stats: null, thumb: '', is2d: false, info2d: null });
	model.box.makeEmpty();
	apply2d();
	buildTree();
	updateProps();
	updateCard();
	$('welcome').classList.remove('hidden');
	setWindowTitle();
	requestRender();
}

function renderTabs() {
	fillExportFormats();
	fillCompareTargets();
	const bar = $('docTabs');
	bar.hidden = docs.length < 2;
	bar.innerHTML = '';
	docs.forEach((d, i) => {
		const t = document.createElement('div');
		t.className = 'doc-tab' + (i === activeDoc ? ' on' : '');
		t.title = d.name;
		t.innerHTML = `<span class="dt-name"></span><button class="dt-close" title="Закрыть (Ctrl+W)">${icon('close')}</button>`;
		t.querySelector('.dt-name').textContent = d.name;
		t.onclick = () => switchDoc(i);
		t.onauxclick = (e) => { if (e.button === 1) closeDoc(i); };
		t.querySelector('.dt-close').onclick = (e) => { e.stopPropagation(); closeDoc(i); };
		bar.append(t);
	});
	// открыт/закрыт файл — обновить списки на страницах «Чертёж» и «Заготовка»
	const page = (document.querySelector('#side .page.on') || {}).dataset || {};
	if (page.page === 'drawing') renderDrawingList();
	if (page.page === 'blank') renderBlankSummary();
}

// =====================================================================
// Кэш триангуляции STEP/IGES (IndexedDB): повторное открытие без OpenCascade
// =====================================================================
const MESH_CACHE_MAX = 1536 * 1024 * 1024; // байт на все модели
const MESH_CACHE_ITEM = 400 * 1024 * 1024;
function meshCacheKey(name, buffer) {
	// отпечаток содержимого: FNV-1a по 64 участкам файла + размер + точность
	const u = new Uint8Array(buffer);
	let h = 0x811c9dc5;
	const chunks = 64, len = 4096;
	for (let c = 0; c < chunks; c++) {
		const start = Math.floor((u.length - len) * c / (chunks - 1));
		for (let i = Math.max(0, start), e = Math.min(u.length, start + len); i < e; i++) { h ^= u[i]; h = Math.imul(h, 0x01000193); }
	}
	return `${u.length}:${(h >>> 0).toString(16)}:${settings.quality}`;
}
function meshCacheMeta() { return safeJson(lsGet('mvMeshCache')).items || []; }
function meshCacheSaveMeta(items) { try { localStorage.setItem('mvMeshCache', JSON.stringify({ items })); } catch { } }
async function meshCacheGet(key) {
	try {
		// кэш не должен задерживать открытие файла
		const d = await Promise.race([db(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 1500))]);
		const rec = await new Promise((res) => {
			const r = d.transaction('meshcache').objectStore('meshcache').get(key);
			r.onsuccess = () => res(r.result); r.onerror = () => res(null);
		});
		if (rec) {
			const items = meshCacheMeta().map((it) => it.key === key ? { ...it, date: Date.now() } : it);
			meshCacheSaveMeta(items);
		}
		return rec ? rec.res : null;
	} catch { return null; }
}
async function meshCachePut(key, res) {
	try {
		let bytes = 0;
		for (const m of res.meshes) {
			bytes += m.attributes.position.array.byteLength + (m.attributes.normal ? m.attributes.normal.array.byteLength : 0) + (m.index ? m.index.array.byteLength : 0);
		}
		if (bytes > MESH_CACHE_ITEM) return;
		const d = await db();
		const tx = d.transaction('meshcache', 'readwrite');
		const store = tx.objectStore('meshcache');
		store.put({ key, res });
		// самые давние — вон, пока не уложимся в лимит
		let items = meshCacheMeta().filter((it) => it.key !== key);
		items.push({ key, bytes, date: Date.now() });
		items.sort((a, b) => b.date - a.date);
		let total = 0;
		const keep = [];
		for (const it of items) {
			if (total + it.bytes <= MESH_CACHE_MAX && keep.length < 30) { keep.push(it); total += it.bytes; }
			else store.delete(it.key);
		}
		meshCacheSaveMeta(keep);
	} catch { }
}

// =====================================================================
// Сравнение двух ревизий
// =====================================================================
let compareState = null;

// треугольники видимых тел документа в координатах модели (без поворота Y↑/Z↑)
function soupOf(obj) {
	obj.updateMatrixWorld(true);
	const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
	const parts = [];
	let total = 0;
	obj.traverse((m) => {
		if (!m.isMesh || !isShown(m) || (m.name && m.name.startsWith('__'))) return;
		const M = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
		const g = m.geometry, P = g.attributes.position.array, I = g.index ? g.index.array : null;
		const n = I ? I.length : P.length / 3;
		const out = new Float32Array(n * 3);
		const v = new THREE.Vector3();
		for (let k = 0; k < n; k++) {
			const i = (I ? I[k] : k) * 3;
			v.set(P[i], P[i + 1], P[i + 2]).applyMatrix4(M);
			out[k * 3] = v.x; out[k * 3 + 1] = v.y; out[k * 3 + 2] = v.z;
		}
		parts.push(out); total += out.length;
	});
	const soup = new Float32Array(total);
	let o = 0;
	for (const p of parts) { soup.set(p, o); o += p.length; }
	return soup;
}

function fillCompareTargets() {
	const sel = $('cmpB');
	const prev = sel.value;
	sel.innerHTML = '';
	docs.forEach((d, i) => {
		if (i === activeDoc) return;
		const o = document.createElement('option');
		o.value = i; o.textContent = d.name;
		sel.append(o);
	});
	if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
	$('cmpA').textContent = model.name || '—';
	$('cmpRun').disabled = !model.object || !sel.options.length;
	$('cmpHint').hidden = sel.options.length > 0;
	if (model.object && !$('cmpTol').dataset.user) {
		// допуск не меньше погрешности триангуляции, иначе кривые поверхности «отличаются»
		const s = model.box.getSize(new THREE.Vector3());
		const q = (QUALITY[settings.quality] || QUALITY.normal).linearDeflection;
		const tol = Math.max(0.01, 2 * q * (s.x + s.y + s.z) / 3);
		$('cmpTol').value = Number(tol.toPrecision(2));
	}
}

async function runCompare() {
	const bi = +$('cmpB').value;
	const B = docs[bi];
	if (!model.object || !B) return;
	if (model.is2d || B.is2d) { alert('Сравнение работает только для 3D-моделей, не для чертежей DXF/DWG.'); return; }
	const tol = Math.max(1e-4, parseFloat(String($('cmpTol').value).replace(',', '.')) || 0.05);
	exitCompare();
	clearMeasure();
	select(null);
	showLoading('Сравниваю модели…');
	await new Promise((r) => setTimeout(r, 30));
	try {
		const soupA = soupOf(model.object);
		const soupB = soupOf(B.object);
		const res = await compareSoups(soupA, soupB, tol, (which, f) => {
			$('loadingText').textContent = `Сравниваю модели… ${which === 'A' ? 'A → B' : 'B → A'} ${Math.round(f * 100)}%`;
		});
		// вид сравнения: A окрашена по отклонению, добавленное в B — зелёным
		const group = new THREE.Group();
		group.position.copy(model.object.position);
		group.quaternion.copy(model.object.quaternion);
		group.scale.copy(model.object.scale);
		const gA = new THREE.BufferGeometry();
		gA.setAttribute('position', new THREE.BufferAttribute(soupA, 3));
		gA.setAttribute('color', new THREE.BufferAttribute(res.colors, 3));
		gA.computeVertexNormals();
		group.add(new THREE.Mesh(gA, patchSection(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, metalness: 0.1, roughness: 0.6, clippingPlanes: clipping }))));
		if (res.added.length) {
			const gB = new THREE.BufferGeometry();
			gB.setAttribute('position', new THREE.BufferAttribute(res.added, 3));
			gB.computeVertexNormals();
			group.add(new THREE.Mesh(gB, new THREE.MeshStandardMaterial({ color: 0x22c55e, transparent: true, opacity: 0.8, side: THREE.DoubleSide, metalness: 0.1, roughness: 0.5, clippingPlanes: clipping, polygonOffset: true, polygonOffsetFactor: -1 })));
		}
		group.traverse((o) => { o.raycast = () => { }; });
		model.object.visible = false;
		modelRoot.add(group);
		compareState = { group, B, res };
		refreshCaps();
		const sA = model.stats, sB = statsFor(B.object);
		const pct = (a, b) => (b > 0 ? ' (' + fmtNum(100 * a / b, 1) + '%)' : '');
		const same = res.areaRemoved < res.areaA * 1e-4 && res.areaAdded < res.areaB * 1e-4;
		$('cmpResult').innerHTML = `<div class="mres"><b>${same ? 'Модели совпадают в пределах допуска' : 'Найдены отличия'}</b><div class="kv">${kv([
			['Допуск:', fmtNum(tol, 3) + ' мм'],
			['Изменено в A:', fmtNum(res.areaRemoved, 1) + ' мм²' + pct(res.areaRemoved, res.areaA)],
			['Добавлено в B:', fmtNum(res.areaAdded, 1) + ' мм²' + pct(res.areaAdded, res.areaB)],
			['Макс. отклонение:', (res.maxDev > tol ? fmtNum(res.maxDev, 3) + ' мм' : '≤ допуска') + (res.missing ? '; есть элементы, отсутствующие в B (дальше ' + fmtNum(tol * 10, 2) + ' мм)' : '')],
			['Габариты A:', `${fix2(sA.size.x)} × ${fix2(sA.size.y)} × ${fix2(sA.size.z)}`],
			['Габариты B:', `${fix2(sB.size.x)} × ${fix2(sB.size.y)} × ${fix2(sB.size.z)}`],
			['Объём A / B:', (sA.closed ? fmtNum(sA.vol / 1000, 2) : '—') + ' / ' + (sB.closed ? fmtNum(sB.vol / 1000, 2) : '—') + ' см³'],
		])}</div></div>`;
		$('cmpExit').hidden = false;
	} catch (e) {
		console.error(e);
		alert('Не удалось сравнить модели:\n' + (e.message || e));
	} finally {
		hideLoading();
		requestRender();
	}
}

function exitCompare() {
	if (!compareState) return;
	modelRoot.remove(compareState.group);
	compareState.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
	compareState = null;
	if (model.object) model.object.visible = true;
	$('cmpExit').hidden = true;
	$('cmpResult').innerHTML = '';
	refreshCaps();
	requestRender();
}

$('cmpRun').onclick = runCompare;
$('cmpExit').onclick = exitCompare;
$('cmpOpen').onclick = () => $('fileInput').click();
$('cmpTol').oninput = () => { $('cmpTol').dataset.user = '1'; };

// =====================================================================
// Техпроцесс: анализ детали, заготовка, маршрут, эскиз и маршрутная карта в PDF
// =====================================================================
function techTarget() {
	// выделенная в дереве деталь или вся модель
	const root = selected ? selected.obj : model.object;
	const meshes = [];
	if (root) root.traverse((o) => { if (o.isMesh && isShown(o) && !(o.name && o.name.startsWith('__'))) meshes.push(o); });
	return { root, meshes, name: selected ? (selected.obj.name || 'Деталь') : baseName() };
}

function techOptions() {
	return {
		material: $('techMaterial').value,
		blankMode: $('techBlankMode').value,
		heat: $('techHeat').checked, heatText: $('techHeatText').value.trim(),
		grinding: $('techGrind').checked,
		edm: $('techEdm').checked, edmText: '',
		coating: $('techCoat').checked, coatingText: $('techCoatText').value.trim(),
		equipment: settings.techEquipment || {},
	};
}

function saveTechSettings() {
	settings.techMaterial = $('techMaterial').value;
	settings.techAuthor = $('techAuthor').value;
	settings.techHeatText = $('techHeatText').value;
	settings.techCoatText = $('techCoatText').value;
	settings.techBlankMode = $('techBlankMode').value;
	const eq = {};
	$$('#techEquip input[data-eq]').forEach((i) => { if (i.value.trim() && i.value.trim() !== DEFAULT_EQUIPMENT[i.dataset.eq]) eq[i.dataset.eq] = i.value.trim(); });
	settings.techEquipment = eq;
	saveSettings();
}

function initTechPage() {
	$('techMaterial').value = settings.techMaterial || 'Сталь 45 ГОСТ 1050-2013';
	$('techAuthor').value = settings.techAuthor ?? 'Шарапов Р.';
	$('techHeatText').value = settings.techHeatText || 'Закалка и отпуск HRC 40…45';
	$('techCoatText').value = settings.techCoatText || 'Хим. оксидирование';
	$('techBlankMode').value = settings.techBlankMode || 'piece';
	const box = $('techEquip');
	box.innerHTML = '';
	const names = { saw: 'Заготовительная', lathe: 'Токарная', mill: 'Фрезерная', bench: 'Слесарная', heat: 'Термическая', grind: 'Шлифовальная', edm: 'Электроэрозионная', qc: 'Контроль' };
	for (const k of Object.keys(DEFAULT_EQUIPMENT)) {
		const l = document.createElement('label');
		l.className = 'field';
		l.innerHTML = `<span></span><input class="num" data-eq="${k}">`;
		l.querySelector('span').textContent = names[k];
		l.querySelector('input').value = (settings.techEquipment || {})[k] || DEFAULT_EQUIPMENT[k];
		box.append(l);
	}
	$$('#techPage input, #techPage select').forEach((i) => i.addEventListener('change', saveTechSettings));
	updateTechTarget();
}
function updateTechTarget() {
	const t = techTarget();
	$('techTargetName').textContent = model.object ? t.name + (selected ? ' (выделенная деталь)' : '') : '—';
	$('techBuild').disabled = !model.object;
}

async function buildTech() {
	if (model.is2d) { alert('Техпроцесс строится по 3D-модели (STEP, IGES…), а не по чертежу DXF/DWG.'); return; }
	const t = techTarget();
	if (!t.meshes.length) return;
	saveTechSettings();
	showLoading('Анализирую деталь…');
	await new Promise((r) => setTimeout(r, 30));
	try {
		modelRoot.updateMatrixWorld(true);
		const part = analyzePart(t.meshes, (f) => { $('loadingText').textContent = `Анализирую деталь… ${Math.round(f * 100)}%`; });
		const dens = parseFloat(settings.density) || 7.85;
		const blank = userBlankFor(chooseBlank(part, dens, techOptions()));
		const route = buildRoute(part, blank, techOptions());
		const st = statsFor(t.root);
		model.tech = { part, blank, route, name: t.name, meshes: t.meshes, mass: st.closed ? st.vol / 1000 * dens / 1000 : null };
		openTechDialog();
	} catch (e) {
		console.error(e);
		alert('Не удалось проанализировать деталь:\n' + (e.message || e));
	} finally {
		hideLoading();
	}
}

function techMeta() {
	const T = model.tech;
	const d = new Date();
	return {
		name: T.name,
		designation: T.name.replace(/\.[^.]+$/, ''),
		material: T.blank.material || $('techMaterial').value,
		author: $('techAuthor').value,
		date: `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`,
		mass: T.mass != null ? fmtMass(T.mass).replace(' ', ' ') : '—',
		blank: T.blank.text,
		blankMass: fmtMass(T.blank.mass),
		org: APP_TITLE,
	};
}

function openTechDialog() {
	const T = model.tech;
	$('techDlgTitle').textContent = 'Техпроцесс — ' + T.name;
	$('techDlgPart').innerHTML = kv(describePart(T.part));
	$('techDlgBlank').innerHTML = kv([
		['Заготовка:', T.blank.text],
		['Расчёт:', T.blank.note],
		['Масса заготовки:', fmtMass(T.blank.mass)],
		['Масса детали:', T.mass != null ? fmtMass(T.mass) : '—'],
		['Материал:', T.blank.material || $('techMaterial').value],
	]);
	renderRouteEditor();
	$('techSheets').innerHTML = '';
	$('techDlg').hidden = false;
}

function renderRouteEditor() {
	const box = $('techRoute');
	box.innerHTML = '';
	model.tech.route.forEach((op, i) => {
		const card = document.createElement('div');
		card.className = 'op-card';
		card.innerHTML = `
			<div class="op-head">
				<input class="op-no" value="">
				<input class="op-name" value="">
				<button class="mini" data-a="up" title="Выше">${icon('chevUp')}</button>
				<button class="mini down" data-a="down" title="Ниже">${icon('chevUp')}</button>
				<button class="mini" data-a="del" title="Удалить операцию">${icon('close')}</button>
			</div>
			<input class="op-eq" placeholder="Оборудование">
			<textarea class="op-steps" rows="${Math.max(2, op.steps.length)}" placeholder="Переходы — каждый с новой строки"></textarea>
			<textarea class="op-tools" rows="${Math.max(1, (op.tools || []).length)}" placeholder="Инструмент и режимы — каждый с новой строки"></textarea>`;
		card.querySelector('.op-no').value = op.no;
		card.querySelector('.op-name').value = op.name;
		card.querySelector('.op-eq').value = op.equip;
		card.querySelector('.op-steps').value = op.steps.join('\n');
		card.querySelector('.op-tools').value = (op.tools || []).join('\n');
		card.querySelector('.op-no').oninput = (e) => { op.no = e.target.value; };
		card.querySelector('.op-name').oninput = (e) => { op.name = e.target.value; };
		card.querySelector('.op-eq').oninput = (e) => { op.equip = e.target.value; };
		card.querySelector('.op-steps').oninput = (e) => { op.steps = e.target.value.split('\n').map((x) => x.trim()).filter(Boolean); };
		card.querySelector('.op-tools').oninput = (e) => { op.tools = e.target.value.split('\n').map((x) => x.trim()).filter(Boolean); };
		card.querySelectorAll('button[data-a]').forEach((b) => b.onclick = () => {
			const r = model.tech.route;
			if (b.dataset.a === 'del') r.splice(i, 1);
			if (b.dataset.a === 'up' && i > 0) [r[i - 1], r[i]] = [r[i], r[i - 1]];
			if (b.dataset.a === 'down' && i < r.length - 1) [r[i + 1], r[i]] = [r[i], r[i + 1]];
			renumberRoute();
			renderRouteEditor();
		});
		box.append(card);
	});
}
function renumberRoute() { model.tech.route.forEach((op, i) => { op.no = String((i + 1) * 5).padStart(3, '0'); }); }

function techSheets() {
	const T = model.tech;
	return renderSheets({ meshes: T.meshes, part: T.part, route: T.route, meta: techMeta() });
}
async function previewTech() {
	showLoading('Готовлю листы…');
	await new Promise((r) => setTimeout(r, 30));
	try {
		const box = $('techSheets');
		box.innerHTML = '';
		for (const c of techSheets()) {
			const img = document.createElement('img');
			img.src = c.toDataURL('image/png');
			box.append(img);
		}
		box.scrollIntoView({ behavior: 'smooth' });
	} finally { hideLoading(); }
}
async function pdfTech() {
	showLoading('Сохраняю PDF…');
	await new Promise((r) => setTimeout(r, 30));
	try {
		const pdf = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
		techSheets().forEach((c, i) => {
			if (i) pdf.addPage('a4', 'landscape');
			pdf.addImage(c.toDataURL('image/png'), 'PNG', 0, 0, 297, 210, undefined, 'FAST');
		});
		pdf.setProperties({ title: 'Техпроцесс — ' + model.tech.name, creator: APP_TITLE, author: $('techAuthor').value });
		download(pdf.output('blob'), model.tech.name.replace(/\.[^.]+$/, '') + ' — техпроцесс.pdf');
	} catch (e) {
		console.error(e);
		alert('Не удалось сохранить PDF:\n' + (e.message || e));
	} finally { hideLoading(); }
}
async function printTech() {
	showLoading('Готовлю печать…');
	await new Promise((r) => setTimeout(r, 30));
	let frame;
	try {
		const imgs = techSheets().map((c) => `<img src="${c.toDataURL('image/png')}">`).join('');
		frame = document.createElement('iframe');
		frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
		document.body.append(frame);
		frame.contentDocument.write(`<!doctype html><html><head><style>@page{size:A4 landscape;margin:0}body{margin:0}img{width:297mm;height:210mm;display:block;page-break-after:always}</style></head><body>${imgs}</body></html>`);
		frame.contentDocument.close();
		await new Promise((r) => setTimeout(r, 300));
		hideLoading();
		frame.contentWindow.focus();
		frame.contentWindow.print();
	} finally {
		hideLoading();
		setTimeout(() => frame && frame.remove(), 60000);
	}
}

$('techBuild').onclick = buildTech;
$('techAddOp').onclick = () => {
	const r = model.tech.route;
	const at = Math.max(0, r.length - 1); // перед контролем
	r.splice(at, 0, { no: '', name: 'Новая операция', equip: '', steps: ['Содержание операции'], tools: [] });
	renumberRoute();
	renderRouteEditor();
};
$('techRebuild').onclick = () => {
	const T = model.tech;
	T.blank = userBlankFor(chooseBlank(T.part, parseFloat(settings.density) || 7.85, techOptions()));
	T.route = buildRoute(T.part, T.blank, techOptions());
	renderRouteEditor();
};
function ncTech() {
	const T = model.tech;
	const o = { material: $('techMaterial').value, name: T.name.replace(/\.[^.]+$/, '') };
	const rot = T.part.type === 'rotational';
	const txt = rot ? pumaPrograms(T.part, T.blank, o) : kvlPrograms(T.part, T.blank, o);
	download(new Blob([txt.split('\n').join('\r\n')], { type: 'text/plain' }), `${o.name} — ${rot ? 'PUMA' : 'KVL'}.nc`);
}
$('techNc').onclick = ncTech;
$('techPreview').onclick = previewTech;
$('techPdf').onclick = pdfTech;
$('techPrint').onclick = printTech;
$('techDlgClose').onclick = () => { $('techDlg').hidden = true; };
initTechPage();

// =====================================================================
// Анализ любой открытой модели (для чертежа и заготовок)
// =====================================================================
const partCache = new WeakMap(); // object3D модели -> результат analyzePart
// выполнить fn для вкладок idx по очереди (вкладка временно становится активной), потом вернуть исходную
async function withDocs(idx, fn) {
	const back = activeDoc;
	try {
		for (const i of idx) {
			if (!docs[i]) continue;
			switchDoc(i);
			modelRoot.updateMatrixWorld(true);
			await fn(i);
		}
	} finally {
		if (back >= 0 && docs[back] && activeDoc !== back) switchDoc(back);
	}
}
function docMeshes() {
	const meshes = [];
	if (model.object) model.object.traverse((o) => { if (o.isMesh && isShown(o) && !(o.name && o.name.startsWith('__'))) meshes.push(o); });
	return meshes;
}
function activePart(label) {
	let part = partCache.get(model.object);
	if (!part) {
		const meshes = docMeshes();
		if (!meshes.length) return null;
		part = analyzePart(meshes, (f) => { $('loadingText').textContent = `${label}… ${Math.round(f * 100)}%`; });
		partCache.set(model.object, part);
	}
	return part;
}
const docKey = (d) => (d.name || '') + '|' + (d.size || 0);
const docIs3d = (d) => d && d.object && !d.is2d;
function docInfo(i) { return i === activeDoc ? model : docs[i]; }

// =====================================================================
// Заготовка: свои размеры для нарезки
// =====================================================================
const BLK_KINDS = {
	round: { name: 'Круг', a: 'Ø', b: null, area: (a) => Math.PI / 4 * a * a, size: (a) => `Ø${fmtN(a)}` },
	square: { name: 'Квадрат', a: 'сторона', b: null, area: (a) => a * a, size: (a) => `□${fmtN(a)}` },
	hex: { name: 'Шестигранник', a: 'S', b: null, area: (a) => Math.sqrt(3) / 2 * a * a, size: (a) => `S${fmtN(a)}` },
	tube: { name: 'Труба', a: 'Ø', b: 'стенка', area: (a, b) => Math.PI * (a - b) * b, size: (a, b) => `Ø${fmtN(a)}×${fmtN(b)}` },
	strip: { name: 'Полоса', a: 'толщина', b: 'ширина', area: (a, b) => a * b, size: (a, b) => `${fmtN(a)}×${fmtN(b)}` },
	plate: { name: 'Лист / плита', a: 'толщина', b: 'ширина', area: (a, b) => a * b, size: (a, b) => `${fmtN(a)}×${fmtN(b)}`, sheet: true },
};
function fmtN(v) { return (Math.round((+v || 0) * 100) / 100).toLocaleString('ru-RU'); }
function num(v) { const x = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(x) ? x : 0; }
function blkStore() { return safeJson(lsGet('mvBlanks')); }
function blkSave(st) { try { localStorage.setItem('mvBlanks', JSON.stringify(st)); } catch { } }
function blkParams() {
	return { cut: num(settings.blkCut ?? 3), barLen: num(settings.blkBar ?? 6000), density: parseFloat(settings.density) || 7.85 };
}
// расчёт строки: длина с пропилом, штук из хлыста, масса
function blkCalc(r) {
	const P = blkParams();
	const K = BLK_KINDS[r.kind] || BLK_KINDS.round;
	const a = num(r.a), b = num(r.b), L = num(r.L), n = Math.max(0, Math.round(num(r.n)));
	const ok = a > 0 && L > 0 && (!K.b || b > 0);
	const area = ok ? K.area(a, b) : 0;
	const mass1 = ok ? area * L * P.density / 1e6 : null;
	const piece = L + P.cut;
	const perBar = !K.sheet && ok && P.barLen > 0 ? Math.floor((P.barLen + P.cut) / piece) : 0;
	return {
		ok, K, a, b, L, n, mass1, massN: mass1 != null ? mass1 * n : null,
		totalLen: ok ? n * piece : null, perBar, bars: perBar > 0 ? Math.ceil(n / perBar) : 0,
		size: ok ? K.size(a, b) : '—', cut: P.cut,
	};
}
// заготовка по модели (автоматически, по сортаменту)
function autoBlank(part) {
	const b = chooseBlank(part, parseFloat(settings.density) || 7.85, techOptions());
	return b.kind === 'bar' ? { kind: 'round', a: b.D, b: '', L: b.L } : { kind: 'plate', a: b.t, b: b.w, L: b.l };
}
function defaultMaterial() { return settings.techMaterial || 'Сталь 45 ГОСТ 1050-2013'; }

// строки ведомости: открытые 3D-модели + строки, введённые вручную
function blkRows() {
	const st = blkStore();
	const rows = [];
	docs.forEach((d0, i) => {
		const d = docInfo(i);
		if (!docIs3d(d)) return;
		const key = docKey(d);
		rows.push({ key, doc: i, name: d.name.replace(/\.[^.]+$/, ''), ...(st[key] || { material: defaultMaterial(), kind: 'round', a: '', b: '', L: '', n: 1 }), own: !!st[key] });
	});
	for (const m of st.__manual || []) rows.push({ ...m, manual: true, own: true });
	return rows;
}
function blkPut(row) {
	const st = blkStore();
	const v = { material: row.material, kind: row.kind, a: row.a, b: row.b, L: row.L, n: row.n };
	if (row.manual) {
		st.__manual = (st.__manual || []).map((m) => (m.id === row.id ? { ...m, ...v, name: row.name } : m));
	} else st[row.key] = v;
	blkSave(st);
}
// своя заготовка для активной модели -> в формате техпроцесса
function userBlankFor(auto) {
	const st = blkStore()[docKey(model)];
	if (!st) return auto;
	const c = blkCalc(st);
	if (!c.ok) return auto;
	const text = `${c.K.name} ${c.size}${c.K.sheet ? ` ГОСТ 19903, заготовка ${fmtN(c.L)}×${fmtN(c.b)}×${fmtN(c.a)} мм` : `, длина ${fmtN(c.L)} мм`} (свои размеры)`;
	const out = { ...auto, text, mass: c.mass1, note: 'Размеры заготовки заданы вручную во вкладке «Заготовка»', user: true, material: st.material };
	if (st.kind === 'round' && auto.kind === 'bar') Object.assign(out, { D: c.a, L: c.L });
	if (st.kind === 'plate' && auto.kind === 'plate') Object.assign(out, { t: c.a, w: c.b, l: c.L });
	return out;
}

function renderBlankSummary() {
	const box = $('blkSummary');
	const rows = blkRows();
	if (!rows.length) { box.innerHTML = '<div class="muted small">Откройте модели (STEP, IGES…) или добавьте строку вручную в ведомости.</div>'; return; }
	box.innerHTML = rows.map((r) => {
		const c = blkCalc(r);
		return `<div class="blk-item"><b>${esc(r.name || 'Без имени')}</b>${c.ok
			? `${esc(c.K.name)} ${esc(c.size)}, L ${fmtN(c.L)} мм × ${c.n} шт${r.own ? ' <span class="own">— свои</span>' : ''}<br>${esc(r.material || '')}${c.massN != null ? ' · ' + fmtMass(c.massN) : ''}`
			: '<span class="muted">размеры не заданы</span>'}</div>`;
	}).join('');
}

function renderBlankTable() {
	const tb = $('blkRows');
	tb.innerHTML = '';
	const rows = blkRows();
	for (const r of rows) {
		const tr = document.createElement('tr');
		if (r.own) tr.className = 'own';
		const kindOpts = Object.entries(BLK_KINDS).map(([k, K]) => `<option value="${k}"${k === r.kind ? ' selected' : ''}>${K.name}</option>`).join('');
		tr.innerHTML =
			`<td>${r.manual ? `<input class="nm" data-f="name" value="${esc(r.name || '')}" placeholder="Деталь">` : `<span title="${esc(r.name)}">${esc(r.name)}</span>`}</td>` +
			`<td><input data-f="material" value="${esc(r.material || '')}"></td>` +
			`<td><select data-f="kind">${kindOpts}</select></td>` +
			`<td><input class="n" data-f="a" value="${esc(r.a ?? '')}" inputmode="decimal"></td>` +
			`<td><input class="n" data-f="b" value="${esc(r.b ?? '')}" inputmode="decimal"></td>` +
			`<td><input class="n" data-f="L" value="${esc(r.L ?? '')}" inputmode="decimal"></td>` +
			`<td><input class="n" data-f="n" value="${esc(r.n ?? 1)}" inputmode="numeric"></td>` +
			'<td class="calc" data-c="len"></td><td class="calc" data-c="bar"></td><td class="calc" data-c="m1"></td><td class="calc" data-c="mn"></td>' +
			`<td><div class="row-btns">${r.manual ? '' : '<button data-act="auto" title="Заготовка по модели (сортамент + припуски)">Авто</button>'}<button data-act="del" title="${r.manual ? 'Удалить строку' : 'Сбросить свои размеры'}">×</button></div></td>`;
		const upd = () => {
			const c = blkCalc(r);
			const K = c.K;
			const bIn = tr.querySelector('[data-f=b]');
			bIn.disabled = !K.b; bIn.placeholder = K.b || '—';
			tr.querySelector('[data-f=a]').placeholder = K.a;
			tr.querySelector('[data-c=len]').textContent = c.totalLen != null ? fmtN(c.totalLen) + ' мм' : '—';
			tr.querySelector('[data-c=bar]').textContent = c.perBar ? `${c.perBar} (хлыст. ${c.bars})` : '—';
			tr.querySelector('[data-c=m1]').textContent = c.mass1 != null ? fmtMass(c.mass1) : '—';
			tr.querySelector('[data-c=mn]').textContent = c.massN != null ? fmtMass(c.massN) : '—';
		};
		tr.querySelectorAll('[data-f]').forEach((el) => el.addEventListener('input', () => {
			r[el.dataset.f] = el.value;
			r.own = true; tr.className = 'own';
			blkPut(r); upd(); renderBlankTotals(); renderBlankSummary();
		}));
		tr.querySelector('[data-act=del]').onclick = () => {
			const st = blkStore();
			if (r.manual) st.__manual = (st.__manual || []).filter((m) => m.id !== r.id);
			else delete st[r.key];
			blkSave(st); renderBlankTable(); renderBlankSummary();
		};
		const autoBtn = tr.querySelector('[data-act=auto]');
		if (autoBtn) autoBtn.onclick = () => blankAuto([r.doc], true);
		upd();
		tb.append(tr);
	}
	if (!rows.length) tb.innerHTML = '<tr><td colspan="12" class="muted">Нет открытых 3D-моделей — добавьте строку вручную.</td></tr>';
	renderBlankTotals();
}
function renderBlankTotals() {
	const rows = blkRows().map((r) => ({ r, c: blkCalc(r) })).filter((x) => x.c.ok);
	const P = blkParams();
	const n = rows.reduce((s, x) => s + x.c.n, 0);
	const m = rows.reduce((s, x) => s + (x.c.massN || 0), 0);
	$('blkTotals').innerHTML = `<b>Итого</b><div class="kv">${kv([
		['Деталей:', `${n} шт`], ['Масса заготовок:', fmtMass(m)], ['Пропил:', `${fmtN(P.cut)} мм`], ['Хлыст:', `${fmtN(P.barLen)} мм`],
	])}</div>`;
}
// «Авто»: заготовка по модели; force — перезаписать введённые размеры
async function blankAuto(idx, force) {
	showLoading('Подбираю заготовку…');
	await new Promise((res) => setTimeout(res, 30));
	try {
		const st = blkStore();
		await withDocs(idx, async () => {
			const key = docKey(model);
			if (st[key] && !force && blkCalc(st[key]).ok) return;
			const part = activePart('Анализирую ' + model.name);
			if (!part) return;
			st[key] = { material: (st[key] && st[key].material) || defaultMaterial(), n: (st[key] && st[key].n) || 1, ...autoBlank(part) };
		});
		blkSave(st);
	} catch (e) {
		console.error(e);
		alert('Не удалось подобрать заготовку:\n' + (e.message || e));
	} finally {
		hideLoading();
		renderBlankTable(); renderBlankSummary();
	}
}
function cuttingRows() {
	return blkRows().map((r) => ({ r, c: blkCalc(r) })).filter((x) => x.c.ok).map(({ r, c }) => ({
		name: r.name || '—', material: r.material || '', kind: c.K.name, size: c.size, L: c.L, n: c.n, cut: c.cut,
		perBar: c.perBar, bars: c.bars, totalLen: c.totalLen, mass1: c.mass1, massN: c.massN, isSheet: !!c.K.sheet,
	}));
}
function todayStr() { const d = new Date(); return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`; }
function cuttingSheets() {
	const rows = cuttingRows();
	if (!rows.length) { alert('Нет строк с заполненными размерами.'); return null; }
	const P = blkParams();
	return renderCuttingList(rows, { org: APP_TITLE, date: todayStr(), author: settings.techAuthor ?? 'Шарапов Р.', cut: fmtN(P.cut), barLen: P.barLen, density: fmtN(P.density) });
}

// =====================================================================
// Печать / PDF листов (общие для чертежа и ведомости)
// =====================================================================
function sheetsPdf(canvases, title, file) {
	const pdf = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
	canvases.forEach((c, i) => {
		if (i) pdf.addPage('a4', 'landscape');
		pdf.addImage(c.toDataURL('image/png'), 'PNG', 0, 0, 297, 210, undefined, 'FAST');
	});
	pdf.setProperties({ title, creator: APP_TITLE, author: settings.techAuthor || '' });
	download(pdf.output('blob'), file);
}
async function sheetsPrint(canvases) {
	const imgs = canvases.map((c) => `<img src="${c.toDataURL('image/png')}">`).join('');
	const frame = document.createElement('iframe');
	frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
	document.body.append(frame);
	frame.contentDocument.write(`<!doctype html><html><head><style>@page{size:A4 landscape;margin:0}body{margin:0}img{width:297mm;height:210mm;display:block;page-break-after:always}</style></head><body>${imgs}</body></html>`);
	frame.contentDocument.close();
	await new Promise((r) => setTimeout(r, 300));
	frame.contentWindow.focus();
	frame.contentWindow.print();
	setTimeout(() => frame.remove(), 60000);
}
function sheetsShow(box, canvases) {
	box.innerHTML = '';
	for (const c of canvases) { const img = document.createElement('img'); img.src = c.toDataURL('image/png'); box.append(img); }
}
async function busy(text, fn) {
	showLoading(text);
	await new Promise((r) => setTimeout(r, 30));
	try { return await fn(); }
	catch (e) { console.error(e); alert('Ошибка:\n' + (e.message || e)); return null; }
	finally { hideLoading(); }
}

$('blkCut').value = settings.blkCut ?? 3;
$('blkBar').value = settings.blkBar ?? 6000;
$('blkCut').oninput = (e) => { settings.blkCut = num(e.target.value); saveSettings(); renderBlankSummary(); if (!$('blankDlg').hidden) renderBlankTable(); };
$('blkBar').oninput = (e) => { settings.blkBar = num(e.target.value); saveSettings(); renderBlankSummary(); if (!$('blankDlg').hidden) renderBlankTable(); };
$('blkOpen').onclick = () => { $('blkSheets').innerHTML = ''; renderBlankTable(); $('blankDlg').hidden = false; };
$('blankDlgClose').onclick = () => { $('blankDlg').hidden = true; renderBlankSummary(); };
$('blkAddRow').onclick = () => {
	const st = blkStore();
	(st.__manual = st.__manual || []).push({ id: Date.now().toString(36), name: '', material: defaultMaterial(), kind: 'round', a: '', b: '', L: '', n: 1 });
	blkSave(st); renderBlankTable(); renderBlankSummary();
};
$('blkAutoAll').onclick = () => blankAuto(docs.map((d, i) => i).filter((i) => docIs3d(docInfo(i))), false);
$('blkPreview').onclick = () => busy('Готовлю ведомость…', () => { const s = cuttingSheets(); if (s) sheetsShow($('blkSheets'), s); });
$('blkPdf').onclick = () => busy('Сохраняю PDF…', () => { const s = cuttingSheets(); if (s) sheetsPdf(s, 'Ведомость заготовок', `Ведомость заготовок ${todayStr()}.pdf`); });
$('blkPrint').onclick = () => busy('Готовлю печать…', () => { const s = cuttingSheets(); if (s) return sheetsPrint(s); });

// =====================================================================
// Чертёж: эскизы выбранных открытых моделей
// =====================================================================
const drwPicked = new Set(); // ключи файлов, отмеченных для чертежа
function renderDrawingList() {
	const box = $('drwList');
	box.innerHTML = '';
	let any = false;
	docs.forEach((d0, i) => {
		const d = docInfo(i);
		const ok = docIs3d(d);
		const key = docKey(d);
		const row = document.createElement('label');
		row.className = 'pick-row' + (ok ? '' : ' dis');
		row.title = ok ? d.name : 'Чертёж DXF/DWG — эскиз строится только по 3D-модели';
		row.innerHTML = `<input type="checkbox"${ok ? '' : ' disabled'}${ok && drwPicked.has(key) ? ' checked' : ''}><span></span>`;
		row.querySelector('span').textContent = d.name;
		row.querySelector('input').onchange = (e) => { if (e.target.checked) drwPicked.add(key); else drwPicked.delete(key); };
		box.append(row);
		any = true;
	});
	if (!any) box.innerHTML = '<div class="muted small">Откройте одну или несколько моделей — каждая открывается своей вкладкой.</div>';
}
function drwSelected() {
	return docs.map((d, i) => i).filter((i) => docIs3d(docInfo(i)) && drwPicked.has(docKey(docInfo(i))));
}
$('drwAll').onclick = () => { docs.forEach((d, i) => { if (docIs3d(docInfo(i))) drwPicked.add(docKey(docInfo(i))); }); renderDrawingList(); };
$('drwNone').onclick = () => { drwPicked.clear(); renderDrawingList(); };
let drwLast = null;
async function drawingSheets() {
	const idx = drwSelected();
	if (!idx.length) { alert('Отметьте модели для чертежа.'); return null; }
	const out = [];
	const names = [];
	await withDocs(idx, async () => {
		$('loadingText').textContent = 'Строю чертёж: ' + model.name;
		await new Promise((r) => setTimeout(r, 20));
		const part = activePart('Анализирую ' + model.name);
		if (!part) return;
		const dens = parseFloat(settings.density) || 7.85;
		const blank = userBlankFor(chooseBlank(part, dens, techOptions()));
		const st = statsFor(model.object);
		const mass = st.closed ? st.vol / 1000 * dens / 1000 : null;
		const name = model.name;
		const meta = {
			name, designation: name.replace(/\.[^.]+$/, ''),
			material: blank.material || $('techMaterial').value, author: $('techAuthor').value, date: todayStr(),
			mass: mass != null ? fmtMass(mass) : '—', blank: blank.text, blankMass: fmtMass(blank.mass), org: APP_TITLE,
		};
		out.push(...renderDrawing({ meshes: docMeshes(), part, meta, profile: $('drwProfile').checked, holes: $('drwHoles').checked }));
		names.push(meta.designation);
	});
	drwLast = { sheets: out, names };
	return drwLast;
}
const drwFile = (r) => (r.names.length === 1 ? r.names[0] : `Чертежи (${r.names.length} дет.)`) + ' — чертёж.pdf';
$('drwPreview').onclick = () => busy('Строю чертёж…', async () => {
	const r = await drawingSheets();
	if (!r) return;
	sheetsShow($('drwSheets'), r.sheets);
	$('drwDlgTitle').textContent = `Чертёж — ${r.names.join(', ')} (листов: ${r.sheets.length})`;
	$('drwDlg').hidden = false;
});
$('drwPdf').onclick = () => busy('Сохраняю PDF…', async () => { const r = await drawingSheets(); if (r && r.sheets.length) sheetsPdf(r.sheets, 'Чертёж', drwFile(r)); });
$('drwPrint').onclick = () => busy('Готовлю печать…', async () => { const r = await drawingSheets(); if (r && r.sheets.length) return sheetsPrint(r.sheets); });
$('drwDlgPdf').onclick = () => busy('Сохраняю PDF…', () => { if (drwLast) sheetsPdf(drwLast.sheets, 'Чертёж', drwFile(drwLast)); });
$('drwDlgPrint').onclick = () => busy('Готовлю печать…', () => { if (drwLast) return sheetsPrint(drwLast.sheets); });
$('drwDlgClose').onclick = () => { $('drwDlg').hidden = true; };

// =====================================================================
// О программе
// =====================================================================
function showAbout() {
	$('aboutVer').textContent = APP_TITLE;
	$('aboutDlg').hidden = false;
}
$('qAbout').onclick = showAbout;
$('aboutClose').onclick = () => { $('aboutDlg').hidden = true; };

// =====================================================================
// Последние файлы и избранное (IndexedDB)
// =====================================================================
const DB_MAX_BUFFER = 150 * 1024 * 1024;
let dbp = null;
function db() {
	if (!dbp) dbp = new Promise((res, rej) => {
		const r = indexedDB.open('modelview', 2);
		r.onupgradeneeded = () => {
			const d = r.result;
			if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'key' });
			if (!d.objectStoreNames.contains('meshcache')) d.createObjectStore('meshcache', { keyPath: 'key' });
		};
		r.onsuccess = () => {
			// другая вкладка/окно обновляет базу — уступаем, чтобы не блокировать её
			r.result.onversionchange = () => { r.result.close(); dbp = null; };
			res(r.result);
		};
		r.onerror = () => rej(r.error);
		r.onblocked = () => rej(new Error('IndexedDB занята другим окном'));
	});
	return dbp;
}
async function dbAll() {
	try {
		const d = await db();
		return await new Promise((res) => {
			const r = d.transaction('files').objectStore('files').getAll();
			r.onsuccess = () => res(r.result || []);
			r.onerror = () => res([]);
		});
	} catch { return []; }
}
async function dbPut(rec) {
	try { const d = await db(); d.transaction('files', 'readwrite').objectStore('files').put(rec); } catch { }
}
async function dbGet(key) {
	try {
		const d = await db();
		return await new Promise((res) => { const r = d.transaction('files').objectStore('files').get(key); r.onsuccess = () => res(r.result); r.onerror = () => res(null); });
	} catch { return null; }
}
async function dbDel(key) { try { const d = await db(); d.transaction('files', 'readwrite').objectStore('files').delete(key); } catch { } }

const keyOf = () => model.name + '|' + model.size;
async function saveRecent() {
	const key = keyOf();
	const old = await dbGet(key);
	await dbPut({
		key, name: model.name, size: model.size, date: Date.now(), thumb: model.thumb,
		format: model.format, fav: old ? !!old.fav : false,
		buffer: model.size <= DB_MAX_BUFFER ? model.buffer : null,
	});
	const all = (await dbAll()).filter((r) => !r.fav).sort((a, b) => b.date - a.date);
	for (const r of all.slice(15)) dbDel(r.key);
	refreshLists();
}
async function refreshLists() {
	const all = (await dbAll()).sort((a, b) => b.date - a.date);
	fillList($('recentList'), all, 'Здесь появятся открытые файлы');
	fillList($('favList'), all.filter((r) => r.fav), 'Отметьте модель звёздочкой на карточке превью');
}
function fillList(el, recs, emptyText) {
	el.innerHTML = '';
	if (!recs.length) { el.innerHTML = `<div class="empty">${emptyText}</div>`; return; }
	for (const r of recs) {
		const row = document.createElement('div');
		row.className = 'file-row';
		row.innerHTML = `<img alt=""><div class="fi"><b></b><small></small></div>`;
		row.querySelector('img').src = r.thumb || '';
		row.querySelector('b').textContent = r.name;
		row.querySelector('small').textContent = `${fmtSize(r.size)} · ${new Date(r.date).toLocaleDateString('ru-RU')}${r.buffer ? '' : ' · нет копии'}`;
		row.title = r.buffer ? 'Открыть' : 'Файл слишком большой для сохранения — откройте его заново';
		row.onclick = async () => {
			const full = await dbGet(r.key);
			if (full && full.buffer) { showPage('model'); openBuffer(full.name, full.buffer); }
			else $('fileInput').click();
		};
		el.append(row);
	}
}
async function refreshFavButton() {
	const r = model.object ? await dbGet(keyOf()) : null;
	$('cardFav').classList.toggle('on', !!(r && r.fav));
}
$('cardFav').onclick = async () => {
	const r = await dbGet(keyOf());
	if (!r) return;
	r.fav = !r.fav;
	await dbPut(r);
	refreshFavButton();
	refreshLists();
};
refreshLists();

// =====================================================================
// Сечение
// =====================================================================
let sectionOn = false, secAxis = 'z';
function setupSection() {
	const b = model.box;
	const i = secAxis;
	const min = b.min[i], max = b.max[i];
	const pos = min + (max - min) * (+$('secPos').value / 1000);
	const flip = $('secFlip').checked;
	const n = new THREE.Vector3(); n[i] = flip ? 1 : -1;
	clipPlane.normal.copy(n);
	clipPlane.constant = flip ? -pos : pos;
	$('secVal').textContent = fix2(pos) + ' мм';
	const fill = sectionOn && $('secFill').checked;
	// в прозрачных режимах сплошной срез не строим — подсвечиваем внутренность
	sectionUniform.value = fill && !capsSupported() ? 1 : 0;
	updateCapPlane();
	requestRender();
}
function setSection(on) {
	sectionOn = on;
	clipping.length = 0;
	if (on) clipping.push(clipPlane);
	$('secOn').checked = on;
	$$('.tool[data-tool=section]').forEach((b) => b.classList.toggle('on', on));
	scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
	edgeMaterial.needsUpdate = true;
	refreshCaps();
	setupSection();
}

// ---------- сплошная заливка среза (трафаретный буфер) ----------
// Для каждого тела рисуем в трафарет задние грани (+1) и передние (−1) без цвета;
// там, где после этого трафарет ≠ 0, плоскость сечения проходит внутри материала —
// туда рисуется «крышка».
const capGroup = new THREE.Group();
capGroup.renderOrder = 1;
scene.add(capGroup);
const capMat = new THREE.MeshStandardMaterial({
	color: 0x3d7dff, metalness: 0.1, roughness: 0.6, side: THREE.DoubleSide,
	stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc,
	stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp,
});
const capPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), capMat);
capPlane.renderOrder = 3;
capPlane.raycast = () => { };
capPlane.onAfterRender = (r) => r.clearStencil();
const stencilMat = (side, op) => new THREE.MeshBasicMaterial({
	side, colorWrite: false, depthWrite: false, depthTest: false, clippingPlanes: [clipPlane],
	stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, stencilFail: op, stencilZFail: op, stencilZPass: op,
});
const stencilBack = stencilMat(THREE.BackSide, THREE.IncrementWrapStencilOp);
const stencilFront = stencilMat(THREE.FrontSide, THREE.DecrementWrapStencilOp);

function capsSupported() { return settings.mode !== 'xray' && settings.mode !== 'wire'; }
function refreshCaps() {
	capGroup.clear();
	if (!(sectionOn && $('secFill').checked && model.object && capsSupported() && !compareState)) return;
	modelRoot.updateMatrixWorld(true);
	for (const m of model.meshes) {
		if (!m.isMesh || !isShown(m)) continue;
		for (const mat of [stencilBack, stencilFront]) {
			const h = new THREE.Mesh(m.geometry, mat);
			h.matrixAutoUpdate = false;
			h.matrix.copy(m.matrixWorld);
			h.renderOrder = 2;
			h.raycast = () => { };
			capGroup.add(h);
		}
	}
	capGroup.add(capPlane);
	updateCapPlane();
}
function updateCapPlane() {
	if (!capPlane.parent) return;
	const c = model.box.getCenter(new THREE.Vector3());
	const R = model.radius * 2.5;
	clipPlane.projectPoint(c, capPlane.position);
	capPlane.lookAt(capPlane.position.clone().add(clipPlane.normal));
	capPlane.scale.set(R, R, 1);
	capPlane.updateMatrix();
}
$$('#secAxis button').forEach((b) => b.onclick = () => {
	secAxis = b.dataset.axis;
	$$('#secAxis button').forEach((x) => x.classList.toggle('on', x === b));
	setupSection();
});
$('secPos').oninput = setupSection;
$('secFlip').onchange = setupSection;
$('secFill').onchange = () => { refreshCaps(); setupSection(); };
$('secOn').onchange = (e) => setSection(e.target.checked);

// =====================================================================
// Измерение
// =====================================================================
// Режимы: points — расстояние между точками (привязка к вершинам);
// diameter — Ø/R отверстия, вала, скругления; faces — две грани: толщина,
// межосевое расстояние, расстояние от оси до плоскости или угол.
const measure = { mode: 'diameter', pending: [], items: [], group: new THREE.Group(), labels: [] };
scene.add(measure.group);
const mPointMat = new THREE.PointsMaterial({ color: 0x4d93ff, size: 10, sizeAttenuation: false, depthTest: false });
const mLineMat = new THREE.LineBasicMaterial({ color: 0x4d93ff, depthTest: false });
const faceMat = (color) => new THREE.MeshBasicMaterial({
	color, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide,
	polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
});
const mFaceMats = [faceMat(0x2f7bff), faceMat(0xff9a1f)];
const MODE_HINT = {
	points: 'Кликните две точки на модели. Рядом с вершиной точка привязывается к ней.',
	diameter: 'Кликните по отверстию, валу или скруглению — покажу Ø и R. По плоскости — площадь.',
	faces: 'Кликните две грани: толщина между плоскостями, межосевое расстояние отверстий, от оси до плоскости или угол.',
};
const MODE_HINT_2D = {
	points: 'Кликните две точки на чертеже. Точка привязывается к концам отрезков и центрам дуг.',
	diameter: 'Кликните по окружности или дуге — покажу Ø и R. По отрезку — длину и угол.',
	faces: 'Кликните два элемента: отрезки — расстояние между параллельными или угол; окружности — межосевое расстояние.',
};

const toModelPoint = (v) => v.clone().applyMatrix4(new THREE.Matrix4().copy(modelRoot.matrixWorld).invert());
const toModelDir = (v) => v.clone().transformDirection(new THREE.Matrix4().copy(modelRoot.matrixWorld).invert());

function mAdd(obj, order = 998) { obj.renderOrder = order; obj.raycast = () => { }; measure.group.add(obj); return obj; }
function mPoint(p) { return mAdd(new THREE.Points(new THREE.BufferGeometry().setFromPoints([p]), mPointMat), 999); }
function mLine(a, b, mat = mLineMat) { return mAdd(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), mat)); }
function mLabel(pos, html) {
	const el = document.createElement('div');
	el.className = 'mlabel';
	el.innerHTML = html;
	$('labels').append(el);
	measure.labels.push({ el, pos: pos.clone() });
}
// подсветка выбранной грани
function mFace(mesh, tris, mat) {
	const g = mesh.geometry, P = g.attributes.position.array, I = g.index ? g.index.array : null;
	const out = new Float32Array(tris.length * 9);
	const v = new THREE.Vector3();
	let k = 0;
	for (const t of tris) for (let j = 0; j < 3; j++) {
		const i = (I ? I[t * 3 + j] : t * 3 + j) * 3;
		v.set(P[i], P[i + 1], P[i + 2]).applyMatrix4(mesh.matrixWorld);
		out[k++] = v.x; out[k++] = v.y; out[k++] = v.z;
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.BufferAttribute(out, 3));
	return mAdd(new THREE.Mesh(geo, mat), 997);
}
// окружность и штрихпунктирная ось цилиндрической грани
function mCircle(f) {
	const pts = [];
	const full = f.sweep > 5.2;
	const a1 = full ? Math.PI * 2 : f.sweep;
	const a0 = 0;
	for (let i = 0; i <= 96; i++) {
		const t = a0 + (a1 - a0) * i / 96 + (full ? 0 : f.startAngle || 0);
		pts.push(f.center.clone().addScaledVector(f.u, Math.cos(t) * f.radius).addScaledVector(f.v, Math.sin(t) * f.radius));
	}
	mAdd(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mLineMat));
	const ext = Math.max(f.axisStart.distanceTo(f.axisEnd) * 0.6, f.radius * 1.3);
	const mat = new THREE.LineDashedMaterial({ color: 0xffb02e, depthTest: false, dashSize: f.radius * 0.25, gapSize: f.radius * 0.12 });
	const line = mLine(f.center.clone().addScaledVector(f.axis, -ext), f.center.clone().addScaledVector(f.axis, ext), mat);
	line.computeLineDistances();
}

function clearMeasure() {
	measure.pending = [];
	measure.items = [];
	measure.group.children.slice().forEach((c) => {
		c.geometry.dispose();
		if (c.material && c.material.isLineDashedMaterial) c.material.dispose();
		measure.group.remove(c);
	});
	measure.labels.forEach((l) => l.el.remove());
	measure.labels = [];
	renderMeasureResults();
	requestRender();
}

function renderMeasureResults() {
	const el = $('measResult');
	if (!el) return;
	let html = '';
	if (measure.pending.length) html += `<div class="muted">${measure.mode === 'points' ? 'Укажите вторую точку' : view2d ? 'Укажите второй элемент' : 'Укажите вторую грань'}</div>`;
	else if (!measure.items.length) html += `<div class="muted">${(view2d ? MODE_HINT_2D : MODE_HINT)[measure.mode]}</div>`;
	for (const it of measure.items.slice().reverse()) {
		html += `<div class="mres"><b>${esc(it.title)}</b><div class="kv">${kv(it.rows)}</div>${it.note ? `<div class="muted small">${esc(it.note)}</div>` : ''}</div>`;
	}
	el.innerHTML = html;
}

// привязка к ближайшей вершине треугольника (в пределах 14 px)
function snapToVertex(h) {
	if (!h.face) return h.point.clone();
	const P = h.object.geometry.attributes.position.array;
	const r = canvas.getBoundingClientRect();
	const scr = (v) => { const q = v.clone().project(camera); return [(q.x + 1) / 2 * r.width, (1 - q.y) / 2 * r.height]; };
	const hp = scr(h.point);
	let best = null, bestD = 14;
	for (const i of [h.face.a, h.face.b, h.face.c]) {
		const v = new THREE.Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]).applyMatrix4(h.object.matrixWorld);
		const sp = scr(v);
		const d = Math.hypot(sp[0] - hp[0], sp[1] - hp[1]);
		if (d < bestD) { bestD = d; best = v; }
	}
	return best || h.point.clone();
}

function describeFace(f) {
	const rows = [];
	let title;
	if (f.type === 'cylinder') {
		const full = f.sweep > THREE.MathUtils.degToRad(300);
		title = full ? (f.hole ? 'Отверстие' : 'Вал / цилиндр') : (f.hole ? 'Скругление (вогнутое)' : 'Скругление (выпуклое)');
		rows.push(['Диаметр:', 'Ø ' + fix3(f.radius * 2) + ' мм'], ['Радиус:', 'R ' + fix3(f.radius) + ' мм']);
		if (!full) rows.push(['Дуга:', fmtNum(THREE.MathUtils.radToDeg(f.sweep), 1) + '°']);
		rows.push(['Длина по оси:', fix2(f.axisStart.distanceTo(f.axisEnd)) + ' мм']);
		const c = toModelPoint(f.center), ax = toModelDir(f.axis);
		rows.push(['Центр:', `${fix2(c.x)}; ${fix2(c.y)}; ${fix2(c.z)}`], ['Ось:', `${fix3(ax.x)}; ${fix3(ax.y)}; ${fix3(ax.z)}`]);
	} else if (f.type === 'plane') {
		title = 'Плоская грань';
		const n = toModelDir(f.normal);
		rows.push(['Площадь:', fmtNum(f.area, 2) + ' мм²'], ['Нормаль:', `${fix3(n.x)}; ${fix3(n.y)}; ${fix3(n.z)}`]);
	} else {
		title = 'Криволинейная грань';
		rows.push(['Площадь:', fmtNum(f.area, 2) + ' мм²']);
	}
	return { title, rows, note: f.exact ? '' : 'Модель без граней CAD (STL/OBJ) — значение по сетке, приблизительно.' };
}

function measurePick(h) {
	if (model.is2d) { measurePick2d(h); return; }
	if (!h || !h.object.isMesh || h.faceIndex == null) return;
	const mode = measure.mode;
	if (mode === 'points') {
		const p = snapToVertex(h);
		mPoint(p);
		measure.pending.push(p);
		if (measure.pending.length === 2) {
			const [a, b] = measure.pending;
			measure.pending = [];
			mLine(a, b);
			const d = toModelPoint(b).sub(toModelPoint(a));
			mLabel(a.clone().add(b).multiplyScalar(0.5), `<b>${fix2(d.length())} мм</b>`);
			measure.items.push({ title: 'Расстояние', rows: [
				['Расстояние:', fix3(d.length()) + ' мм'],
				['ΔX:', fix3(Math.abs(d.x)) + ' мм'], ['ΔY:', fix3(Math.abs(d.y)) + ' мм'], ['ΔZ:', fix3(Math.abs(d.z)) + ' мм'],
			] });
		}
		renderMeasureResults();
		requestRender();
		return;
	}

	let { tris, exact } = faceTriangles(h.object.geometry, h.faceIndex);
	let f = analyzeFace(h.object, tris);
	if (f.type === 'cylinder' && exact) {
		// половинки цилиндра, разрезанного швом, — в одну грань
		const merged = mergeCoaxialFaces(h.object, tris, f);
		if (merged !== tris) {
			const g = analyzeFace(h.object, merged);
			if (g.type === 'cylinder') { tris = merged; f = g; }
		}
	}
	f.exact = exact;

	if (mode === 'diameter') {
		mFace(h.object, tris, mFaceMats[0]);
		if (f.type === 'cylinder') {
			mCircle(f);
			const full = f.sweep > THREE.MathUtils.degToRad(300);
			const mid = (f.startAngle || 0) + (full ? Math.PI / 4 : f.sweep / 2);
			const onCircle = f.center.clone().addScaledVector(f.u, f.radius * Math.cos(mid)).addScaledVector(f.v, f.radius * Math.sin(mid));
			mLabel(onCircle, full ? `<b>Ø ${fix2(f.radius * 2)} мм</b>` : `<b>R ${fix2(f.radius)} мм</b>`);
		} else if (f.type === 'plane') {
			mLabel(f.centroid, `<b>${fmtNum(f.area, 1)} мм²</b>`);
		}
		measure.items.push(describeFace(f));
		renderMeasureResults();
		requestRender();
		return;
	}

	// две грани
	mFace(h.object, tris, mFaceMats[measure.pending.length % 2]);
	measure.pending.push(f);
	if (measure.pending.length === 2) {
		const [f1, f2] = measure.pending;
		measure.pending = [];
		const r = relate(f1, f2);
		if (r) {
			const isDist = r.unit === 'мм';
			if (isDist) {
				mLine(r.a, r.b); mPoint(r.a); mPoint(r.b);
				mLabel(r.a.clone().add(r.b).multiplyScalar(0.5), `<b>${fix2(r.value)} мм</b>`);
			} else {
				mLabel(r.a.clone().add(r.b).multiplyScalar(0.5), `<b>${fmtNum(r.value, 2)}°</b>`);
			}
			const rows = [[isDist ? 'Значение:' : 'Угол:', isDist ? fix3(r.value) + ' мм' : fmtNum(r.value, 3) + '°']];
			if (r.alt != null) rows.push(['Дополнительный:', fmtNum(r.alt, 3) + '°']);
			const what = (x) => (x.type === 'cylinder' ? (x.hole ? 'отверстие' : 'цилиндр') + ' Ø' + fix2(x.radius * 2) : x.type === 'plane' ? 'плоскость' : 'поверхность');
			rows.push(['Грани:', what(f1) + ' / ' + what(f2)]);
			measure.items.push({ title: r.kind, rows, note: f1.exact && f2.exact ? '' : 'Модель без граней CAD — значение приблизительное.' });
		}
	}
	renderMeasureResults();
	requestRender();
}

// =====================================================================
// Чертёж 2D: режим просмотра и измерения
// =====================================================================
function apply2d() {
	view2d = !!model.is2d;
	document.body.classList.toggle('mode-2d', view2d);
	if (view2d) {
		if (animating) { animating = false; controls.autoRotate = false; $$('.tool[data-tool=animate]').forEach((b) => b.classList.remove('on')); }
		if (sectionOn) setSection(false);
	}
	useCamera(view2d || settings.ortho);
	controls.enableRotate = !view2d;
	applyToolButtons(controls);
	renderMeasureResults();
}
// сколько миллиметров модели в одном пикселе экрана
function pixelWorld() {
	const h = Math.max(1, canvas.clientHeight);
	if (camera.isOrthographicCamera) return (camera.top - camera.bottom) / camera.zoom / h;
	const d = camera.position.distanceTo(controls.target);
	return 2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / h;
}
const V2 = (p) => new THREE.Vector3(p.x, p.y, 0);
function segInfo(h) {
	if (!h || !h.object.userData.dxfLine) return null;
	const i = h.index - (h.index % 2);
	const P = h.object.geometry.attributes.position;
	const a = new THREE.Vector3().fromBufferAttribute(P, i).applyMatrix4(h.object.matrixWorld);
	const b = new THREE.Vector3().fromBufferAttribute(P, i + 1).applyMatrix4(h.object.matrixWorld);
	return { a, b, meta: h.object.userData.segMeta[i / 2] || { k: 'curve' }, point: h.point.clone().setZ(0) };
}
// привязка к концам отрезков и центрам дуг
function snap2d(si) {
	const cand = [si.a, si.b];
	if (si.meta.k === 'line') cand.push(V2(si.meta.a), V2(si.meta.b));
	if (si.meta.k === 'arc') cand.push(V2(si.meta.c));
	let best = si.point, bd = pixelWorld() * 12;
	for (const c of cand) { const d = c.distanceTo(si.point); if (d < bd) { bd = d; best = c; } }
	return best.clone();
}
function describe2d(m) {
	if (m.k === 'arc') {
		const rows = m.full ? [['Диаметр:', 'Ø ' + fix3(m.r * 2) + ' мм'], ['Радиус:', 'R ' + fix3(m.r) + ' мм']]
			: [['Радиус:', 'R ' + fix3(m.r) + ' мм'], ['Диаметр:', 'Ø ' + fix3(m.r * 2) + ' мм'], ['Угол дуги:', fmtNum(THREE.MathUtils.radToDeg(m.sweep), 2) + '°'],
				['Длина дуги:', fix3(m.r * m.sweep) + ' мм']];
		rows.push(['Центр:', `${fix3(m.c.x)}; ${fix3(m.c.y)}`]);
		return { title: m.full ? 'Окружность' : 'Дуга', rows };
	}
	if (m.k === 'line') {
		const dx = m.b.x - m.a.x, dy = m.b.y - m.a.y;
		let ang = THREE.MathUtils.radToDeg(Math.atan2(dy, dx)); if (ang < 0) ang += 180; if (ang >= 180) ang -= 180;
		return { title: 'Отрезок', rows: [['Длина:', fix3(Math.hypot(dx, dy)) + ' мм'], ['ΔX:', fix3(Math.abs(dx)) + ' мм'], ['ΔY:', fix3(Math.abs(dy)) + ' мм'], ['Угол к X:', fmtNum(ang, 3) + '°']] };
	}
	return null;
}
function measurePick2d(h) {
	const si = segInfo(h);
	if (!si) return;
	const mode = measure.mode;
	const m = si.meta;
	if (mode === 'diameter') {
		const d = describe2d(m);
		if (!d) { measure.items.push({ title: 'Кривая', rows: [], note: 'Это сплайн или эллипс — для расстояний используйте режим «Точки».' }); renderMeasureResults(); return; }
		if (m.k === 'arc') {
			const c = V2(m.c);
			if (m.full) {
				const pts = [];
				for (let i = 0; i <= 96; i++) { const t = Math.PI * 2 * i / 96; pts.push(c.clone().add(new THREE.Vector3(Math.cos(t) * m.r, Math.sin(t) * m.r, 0))); }
				mAdd(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mLineMat));
			}
			mPoint(c);
			mLabel(si.point, m.full ? `<b>Ø ${fix2(m.r * 2)} мм</b>` : `<b>R ${fix2(m.r)} мм</b>`);
		} else {
			mLine(V2(m.a), V2(m.b)); mPoint(V2(m.a)); mPoint(V2(m.b));
			mLabel(V2(m.a).add(V2(m.b)).multiplyScalar(0.5), `<b>${fix2(V2(m.a).distanceTo(V2(m.b)))} мм</b>`);
		}
		measure.items.push(d);
	} else if (mode === 'points') {
		const p = snap2d(si);
		mPoint(p);
		measure.pending.push(p);
		if (measure.pending.length === 2) {
			const [a, b] = measure.pending;
			measure.pending = [];
			mLine(a, b);
			const d = b.clone().sub(a);
			mLabel(a.clone().add(b).multiplyScalar(0.5), `<b>${fix2(d.length())} мм</b>`);
			measure.items.push({ title: 'Расстояние', rows: [['Расстояние:', fix3(d.length()) + ' мм'], ['ΔX:', fix3(Math.abs(d.x)) + ' мм'], ['ΔY:', fix3(Math.abs(d.y)) + ' мм']] });
		}
	} else {
		// два элемента: отрезки — расстояние между параллельными или угол; окружности — межосевое
		if (m.k !== 'line' && m.k !== 'arc') { measure.items.push({ title: 'Кривая', rows: [], note: 'Выберите отрезок, окружность или дугу.' }); renderMeasureResults(); return; }
		if (m.k === 'line') mLine(V2(m.a), V2(m.b)); else mPoint(V2(m.c));
		measure.pending.push(m);
		if (measure.pending.length === 2) {
			const [f1, f2] = measure.pending;
			measure.pending = [];
			const r = relate2d(f1, f2);
			if (r.a) { mLine(r.a, r.b); mPoint(r.a); mPoint(r.b); }
			mLabel(r.at, `<b>${r.label}</b>`);
			measure.items.push({ title: r.title, rows: r.rows });
		}
	}
	renderMeasureResults();
	requestRender();
}
function relate2d(f1, f2) {
	const lineDir = (f) => V2(f.b).sub(V2(f.a)).normalize();
	const footOnLine = (p, f) => { const a = V2(f.a), u = lineDir(f); return a.clone().addScaledVector(u, p.clone().sub(a).dot(u)); };
	if (f1.k === 'arc' && f2.k === 'arc') {
		const a = V2(f1.c), b = V2(f2.c), d = b.clone().sub(a);
		return {
			title: 'Межосевое расстояние', a, b, at: a.clone().add(b).multiplyScalar(0.5), label: fix2(d.length()) + ' мм',
			rows: [['Между центрами:', fix3(d.length()) + ' мм'], ['ΔX:', fix3(Math.abs(d.x)) + ' мм'], ['ΔY:', fix3(Math.abs(d.y)) + ' мм'], ['Окружности:', `Ø${fix2(f1.r * 2)} / Ø${fix2(f2.r * 2)}`]],
		};
	}
	if (f1.k === 'line' && f2.k === 'line') {
		const u = lineDir(f1), v = lineDir(f2);
		const ang = THREE.MathUtils.radToDeg(Math.acos(Math.min(1, Math.abs(u.dot(v)))));
		if (ang < 0.05) {
			const mid = V2(f2.a).add(V2(f2.b)).multiplyScalar(0.5);
			const foot = footOnLine(mid, f1);
			const dist = mid.distanceTo(foot);
			return { title: 'Расстояние между параллельными', a: foot, b: mid, at: foot.clone().add(mid).multiplyScalar(0.5), label: fix2(dist) + ' мм', rows: [['Расстояние:', fix3(dist) + ' мм']] };
		}
		const at = V2(f1.a).add(V2(f1.b)).add(V2(f2.a)).add(V2(f2.b)).multiplyScalar(0.25);
		return { title: 'Угол', at, label: fmtNum(ang, 2) + '°', rows: [['Угол:', fmtNum(ang, 3) + '°'], ['Дополнительный:', fmtNum(180 - ang, 3) + '°']] };
	}
	const L = f1.k === 'line' ? f1 : f2, C = f1.k === 'arc' ? f1 : f2;
	const c = V2(C.c), foot = footOnLine(c, L), dist = c.distanceTo(foot);
	return {
		title: 'От центра до прямой', a: c, b: foot, at: c.clone().add(foot).multiplyScalar(0.5), label: fix2(dist) + ' мм',
		rows: [['От центра до прямой:', fix3(dist) + ' мм'], ['До края окружности:', fix3(Math.abs(dist - C.r)) + ' мм']],
	};
}

function updateMeasureLabels() {
	if (!measure.labels.length) return;
	const w = canvas.clientWidth, h = canvas.clientHeight;
	for (const l of measure.labels) {
		const p = l.pos.clone().project(camera);
		l.el.style.left = (p.x * 0.5 + 0.5) * w + 'px';
		l.el.style.top = (-p.y * 0.5 + 0.5) * h + 'px';
		l.el.style.display = p.z > 1 ? 'none' : '';
	}
}
function setMeasureMode(m) {
	measure.mode = m;
	measure.pending = [];
	$$('#measMode button[data-m]').forEach((b) => { if (b.dataset.m !== 'dims') b.classList.toggle('on', b.dataset.m === m); });
	renderMeasureResults();
}
$$('#measMode button').forEach((b) => b.onclick = () => {
	const m = b.dataset.m;
	if (m === 'clear') { clearMeasure(); return; }
	if (m === 'dims') { setOpt('dims', !settings.dims); b.classList.toggle('on', settings.dims); return; }
	setMeasureMode(m);
	setTool('measure');
});

// =====================================================================
// Инструменты
// =====================================================================
function applyToolButtons(c) {
	const L = tool === 'pan' || (view2d && tool === 'rotate') ? THREE.MOUSE.PAN : tool === 'zoom' ? THREE.MOUSE.DOLLY : THREE.MOUSE.ROTATE;
	c.mouseButtons = { LEFT: L, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
}
function setTool(t) {
	if (view2d && (t === 'section' || t === 'animate')) return; // у плоского чертежа нет сечений и вращения
	if (t === 'section') {
		setSection(!sectionOn);
		if (sectionOn) showPage('sections');
		return;
	}
	if (t === 'style') {
		const pop = $('stylePop');
		pop.hidden = !pop.hidden;
		$$('.tool[data-tool=style]').forEach((b) => b.classList.toggle('on', !pop.hidden));
		return;
	}
	if (t === 'animate') {
		animating = !animating;
		controls.autoRotate = animating;
		$$('.tool[data-tool=animate]').forEach((b) => b.classList.toggle('on', animating));
		requestRender();
		return;
	}
	if (tool === 'measure' && t !== 'measure') { measure.pending = []; renderMeasureResults(); }
	tool = t;
	$$('.tool:not([data-toggle])').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
	viewport.className = 'cur-' + t;
	applyToolButtons(controls);
	if (t === 'measure') showPage('measures');
}
$$('.tool').forEach((b) => b.onclick = () => setTool(b.dataset.tool));

// =====================================================================
// Пикинг
// =====================================================================
const raycaster = new THREE.Raycaster();
function pick(ev) {
	if (!model.object) return null;
	const r = canvas.getBoundingClientRect();
	const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
	raycaster.setFromCamera(ndc, camera);
	raycaster.params.Points.threshold = model.radius * 0.005;
	raycaster.params.Line.threshold = model.is2d ? pixelWorld() * 6 : 1;
	for (const h of raycaster.intersectObject(model.object, true)) {
		if (!isShown(h.object)) continue;
		if (sectionOn && clipPlane.distanceToPoint(h.point) < 0) continue;
		return h;
	}
	return null;
}
let downPos = null;
canvas.addEventListener('pointerdown', (e) => { downPos = [e.clientX, e.clientY, e.button]; if (animating) setTool('animate'); });
canvas.addEventListener('pointerup', (e) => {
	if (!downPos || downPos[2] !== 0) return;
	const moved = Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]);
	downPos = null;
	if (moved > 4) return;
	const h = pick(e);
	if (tool === 'measure') { measurePick(h); return; }
	// в чертеже выделяется и скрывается весь слой
	const target = h ? (model.is2d ? h.object.parent : h.object) : null;
	if (tool === 'hide') { if (target) { if (selected && selected.obj === target) select(null); setVisible(target, false); } return; }
	select(target);
});
canvas.addEventListener('dblclick', (e) => {
	const h = pick(e);
	if (!h) return;
	const delta = h.point.clone().sub(controls.target);
	controls.target.copy(h.point);
	camera.position.add(delta);
	controls.update();
	requestRender();
});

// =====================================================================
// Левое меню / страницы
// =====================================================================
function showPage(p) {
	$$('.nav-item[data-page]').forEach((b) => b.classList.toggle('on', b.dataset.page === p));
	$$('#side .page').forEach((x) => x.classList.toggle('on', x.dataset.page === p));
	if (p === 'recent' || p === 'favorites') refreshLists();
	if (p === 'compare') fillCompareTargets();
	if (p === 'tech') updateTechTarget();
	if (p === 'drawing') {
		if (!drwPicked.size && docIs3d(model)) drwPicked.add(docKey(model));
		renderDrawingList();
	}
	if (p === 'blank') renderBlankSummary();
}
$$('.nav-item[data-page]').forEach((b) => b.onclick = () => showPage(b.dataset.page));
$('navOpen').onclick = () => $('fileInput').click();

// ---- опции ----
const OPT_IDS = { edges: 'optEdges', dims: 'optDims', shadows: 'optShadows', grid: 'optGrid', ortho: 'optOrtho' };
function setOpt(name, v) {
	if (name === 'ortho') { setOrtho(v); return; }
	settings[name] = v; saveSettings(); syncControls();
	if (name === 'dims' && model.object) fitTo(model.box);
	applyMode();
}
function syncControls() {
	for (const [k, id] of Object.entries(OPT_IDS)) {
		$(id).checked = !!settings[k];
		$$(`[data-link=${id}]`).forEach((x) => x.checked = !!settings[k]);
	}
	$$('#measMode [data-m=dims]').forEach((b) => b.classList.toggle('on', settings.dims));
}
for (const [k, id] of Object.entries(OPT_IDS)) {
	$(id).onchange = (e) => setOpt(k, e.target.checked);
	$$(`[data-link=${id}]`).forEach((x) => x.onchange = (e) => setOpt(k, e.target.checked));
}
$('optYUp').onchange = (e) => {
	if (!model.object) return;
	model.yUp = e.target.checked; applyUpAxis(); updateBounds(); computeStats(); updateProps(); setView('iso');
};
$('density').value = settings.density;
$('density').onchange = (e) => { settings.density = e.target.value; saveSettings(); updateProps(); };
$('meshUnit').value = settings.meshUnit;
$('meshUnit').onchange = (e) => {
	settings.meshUnit = e.target.value; saveSettings();
	if (model.buffer && !OCCT_FORMATS[model.ext] && !DRAW_FORMATS[model.ext]) openBuffer(model.name, model.buffer, { noRecent: true, replace: true });
};
$('quality').value = settings.quality;
$('quality').onchange = (e) => {
	settings.quality = e.target.value; saveSettings();
	if (model.buffer && OCCT_FORMATS[model.ext]) openBuffer(model.name, model.buffer, { noRecent: true, replace: true });
};
$$('#modes .mode').forEach((b) => b.onclick = () => { settings.mode = b.dataset.mode; saveSettings(); applyMode(); });

// ---- быстрые кнопки ----
$('qFit').onclick = () => model.object && fitTo(model.box);
$('qShot').onclick = $('expPng').onclick = () => {
	render();
	canvas.toBlob((blob) => download(blob, baseName() + '.png'));
};
$('qFull').onclick = () => {
	if (window.pywebview && window.pywebview.api) { window.pywebview.api.toggle_fullscreen(); return; }
	if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => { });
};

// ---- экспорт ----
function visibleGroup() {
	const g = new THREE.Group();
	modelRoot.updateMatrixWorld(true);
	const toModel = new THREE.Matrix4().copy(modelRoot.matrixWorld).invert();
	for (const m of model.meshes) {
		if (!m.isMesh || !isShown(m)) continue;
		const geo = m.geometry.clone();
		geo.deleteAttribute('color');
		geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toModel, m.matrixWorld));
		const mm = new THREE.Mesh(geo);
		mm.name = m.name;
		g.add(mm);
	}
	return g;
}
// «Сохранить как» — копия исходного файла; «Экспорт» — запись в выбранный формат
function fillExportFormats() {
	const sel = $('expFmt'); if (!sel) return;
	const keep = sel.value;
	const list = model.object ? (model.is2d ? FORMATS2D : FORMATS3D).concat(FORMATSIMG) : [];
	sel.innerHTML = list.map((f) => `<option value="${f.id}">${f.name}</option>`).join('') || '<option>— откройте файл —</option>';
	if (list.some((f) => f.id === keep)) sel.value = keep;
	$('expHint').textContent = !model.object ? 'Откройте модель или чертёж.' : model.is2d
		? 'Чертёж выгружается линиями и надписями видимых слоёв (дуги и сплайны — отрезками). DWG → DXF так тоже можно перевести.'
		: 'Выгружаются видимые детали сеткой треугольников. STEP/IGES программа записать не может — для них «Сохранить как».';
	const ext = (model.ext || '').toUpperCase();
	$('expSaveAsHint').textContent = model.object ? `Копия открытого файла (${ext}) под новым именем — без изменений и потерь (Ctrl+Shift+S).` : 'Откройте файл.';
}
$('expSaveAs').onclick = saveAsOriginal;
async function saveAsOriginal() {
	if (!model.object || !model.buffer) { alert('Сначала откройте файл.'); return; }
	await download(new Blob([model.buffer]), model.name || ('модель.' + (model.ext || 'bin')));
}
$('expGo').onclick = async () => {
	if (!model.object) { alert('Сначала откройте файл.'); return; }
	const id = $('expFmt').value, all = FORMATS3D.concat(FORMATS2D, FORMATSIMG), f = all.find((x) => x.id === id);
	if (!f) return;
	showLoading('Экспорт ' + f.ext.toUpperCase() + '…', false);
	try {
		let blob;
		if (id === 'png' || id === 'jpg') {
			render();
			blob = await new Promise((r) => canvas.toBlob(r, id === 'jpg' ? 'image/jpeg' : 'image/png', 0.92));
		} else if (model.is2d) {
			const d = collect2d(model.object, isShown);
			blob = id === 'dxf' ? new Blob([writeDxf(d)], { type: 'image/vnd.dxf' }) : id === 'svg' ? writeSvg(d) : writePdf(d, model.name);
		} else {
			const g = visibleGroup();
			if (!g.children.length) throw new Error('Нет видимых деталей');
			try { blob = await export3d(id, g); } finally { disposeObject(g); }
		}
		hideLoading();
		await download(blob, baseName() + '.' + f.ext);
	} catch (e) { hideLoading(); alert('Не удалось экспортировать:\n' + (e && e.message || e)); }
};
function baseName() { return (model.name || 'модель').replace(/\.[^.]+$/, ''); }
async function download(blob, name) {
	// в программе — обычное окно «Сохранить как», в браузере — скачивание
	const api = window.pywebview && window.pywebview.api;
	if (api && api.save_file) {
		const b64 = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(blob); });
		try { await api.save_file(name, b64); } catch (e) { alert('Не удалось сохранить файл:\n' + e); }
		return;
	}
	const a = document.createElement('a');
	a.href = URL.createObjectURL(blob);
	a.download = name;
	a.click();
	setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

// =====================================================================
// Открытие файлов
// =====================================================================
async function openFile(file) {
	showPage('model');
	openBuffer(file.name, await file.arrayBuffer());
}
$('fileInput').onchange = (e) => { for (const f of e.target.files) openFile(f); e.target.value = ''; };
$('loadCancel').onclick = cancelLoad;
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('dropOverlay').hidden = false; });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('dropOverlay').hidden = true; } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
	e.preventDefault(); dragDepth = 0; $('dropOverlay').hidden = true;
	// можно бросить сразу несколько файлов — каждый откроется своей вкладкой
	for (const f of e.dataTransfer.files) openFile(f);
});

// ---- клавиатура ----
window.addEventListener('keydown', (e) => {
	if (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'range') return;
	if (e.target.tagName === 'SELECT') return;
	if (e.ctrlKey && e.code === 'KeyO') { e.preventDefault(); $('fileInput').click(); return; }
	if (e.ctrlKey && e.shiftKey && e.code === 'KeyS') { e.preventDefault(); saveAsOriginal(); return; }
	if (e.ctrlKey && !e.shiftKey && e.code === 'KeyE') { e.preventDefault(); showPage('export'); return; }
	if (e.ctrlKey && e.code === 'KeyW') { e.preventDefault(); if (activeDoc >= 0) closeDoc(activeDoc); return; }
	if (e.ctrlKey && e.code === 'Tab') {
		e.preventDefault();
		if (docs.length > 1) switchDoc((activeDoc + (e.shiftKey ? docs.length - 1 : 1)) % docs.length);
		return;
	}
	if (e.ctrlKey || e.altKey || e.metaKey) return;
	const view = (v) => () => model.object && setView(v);
	const map = {
		KeyF: () => model.object && fitTo(model.box), KeyE: () => setOpt('edges', !settings.edges),
		KeyO: () => setOrtho(!settings.ortho), KeyG: () => setOpt('grid', !settings.grid),
		KeyD: () => setOpt('dims', !settings.dims),
		KeyS: () => setTool('section'), KeyM: () => setTool('measure'), KeyH: () => setTool('hide'),
		KeyR: () => setTool('rotate'), KeyA: () => setTool('animate'), KeyP: () => $('qShot').click(),
		Digit1: view('front'), Digit2: view('back'), Digit3: view('left'),
		Digit4: view('right'), Digit5: view('top'), Digit6: view('bottom'), Digit0: view('iso'),
		F11: () => $('qFull').click(),
		Escape: () => {
			if (!$('techDlg').hidden) { $('techDlg').hidden = true; return; }
			if (!$('blankDlg').hidden) { $('blankDlg').hidden = true; renderBlankSummary(); return; }
			if (!$('drwDlg').hidden) { $('drwDlg').hidden = true; return; }
			if (!$('aboutDlg').hidden) { $('aboutDlg').hidden = true; return; }
			clearMeasure(); select(null); if (tool !== 'rotate') setTool('rotate');
		},
		F1: () => showAbout(),
	};
	if (map[e.code]) { e.preventDefault(); map[e.code](); }
});

// =====================================================================
// Утилиты
// =====================================================================
function showLoading(t, cancellable = false) {
	$('loadingText').textContent = t;
	$('loadCancel').hidden = !cancellable;
	$('loading').hidden = false;
}
function hideLoading() { $('loading').hidden = true; }
function fix2(v) { return (Math.abs(v) < 0.005 ? 0 : v).toFixed(2); }
function fix3(v) { return (Math.abs(v) < 0.0005 ? 0 : v).toFixed(3); }
function fmtNum(v, d = 2) { return (+v).toLocaleString('ru-RU', { maximumFractionDigits: d, minimumFractionDigits: 0 }); }
function fmtInt(v) { return v.toLocaleString('ru-RU'); }
function fmtSize(b) { return b >= 1048576 ? (b / 1048576).toFixed(1) + ' МБ' : Math.max(1, Math.round(b / 1024)) + ' КБ'; }
function fmtMass(kg) { return kg >= 1 ? fmtNum(kg, 3) + ' кг' : fmtNum(kg * 1000, 1) + ' г'; }
function niceStep(x) {
	if (!(x > 0)) return 1;
	const p = Math.pow(10, Math.floor(Math.log10(x)));
	const f = x / p;
	return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}

async function openServerFile(id, info) {
	try {
		if (!info) info = await (await fetch('api/info?id=' + id)).json();
		if (!info.name) return;
		showPage('model');
		showLoading(`Читаю ${info.name}…`);
		const buf = await (await fetch('api/file?id=' + id)).arrayBuffer();
		openBuffer(info.name, buf);
	} catch (e) { hideLoading(); }
}
window.openServerFile = openServerFile;

// =====================================================================
// Связь с локальным сервером
// =====================================================================
if (location.protocol.startsWith('http')) {
	fetch('api/initial').then((r) => r.json()).then((info) => { if (info.name) openServerFile(0, info); }).catch(() => { });
}

toggleProps(settings.props);
renderMeasureResults();
syncControls();
applyMode();
resize();
updateProps();
