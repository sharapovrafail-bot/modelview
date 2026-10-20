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
	trash: '<path d="M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13"/>',
	part: `<path d="${CUBE}"/><path d="${CUBE_IN}"/>`,
	assembly: '<path d="M3.5 7A1.5 1.5 0 0 1 5 5.5h4l2 2h8A1.5 1.5 0 0 1 20.5 9v9a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18z"/>',
	cubeSolid: `<path d="${CUBE}" fill="currentColor" fill-opacity=".25"/><path d="${CUBE_IN}"/>`,
	cubeWire: `<path d="${CUBE}"/><path d="${CUBE_IN}"/><path d="M8 5.2v9.3M16 5.2v9.3M4 12l8 4.5 8-4.5" opacity=".6"/>`,
	cubeLines: `<path d="${CUBE}"/><path d="${CUBE_IN}"/><path d="M12 12 4 16.5M12 12l8 4.5M12 3v9" stroke-dasharray="1.5 1.8" opacity=".7"/>`,
	cubeShaded: `<path d="${CUBE}"/><path d="M12 12 20 7.5v9L12 21z" fill="currentColor" fill-opacity=".5"/><path d="${CUBE_IN}"/>`,
	cubeXray: `<path d="${CUBE}" stroke-dasharray="2 1.5"/><path d="${CUBE_IN}" stroke-dasharray="2 1.5"/><circle cx="12" cy="12" r="3"/>`,
};
function icon(name) { return `<svg viewBox="0 0 24 24">${ICONS[name] || ''}</svg>`; }
function renderIcons(root = document) {
	for (const el of $$('i[data-icon]', root)) el.innerHTML = icon(el.dataset.icon);
}
renderIcons();

// =====================================================================
// Константы и настройки
// =====================================================================
const OCCT_FORMATS = { step: 'step', stp: 'step', iges: 'iges', igs: 'iges', brep: 'brep', brp: 'brep' };
const SUPPORTED = ['step', 'stp', 'iges', 'igs', 'brep', 'brp', 'stl', 'obj', 'ply', '3mf', 'glb', 'gltf'];
const QUALITY = {
	fast: { linearDeflection: 0.003, angularDeflection: 0.8 },
	normal: { linearDeflection: 0.001, angularDeflection: 0.5 },
	fine: { linearDeflection: 0.0002, angularDeflection: 0.2 },
};
const DEFAULT_COLOR = new THREE.Color().setRGB(0.74, 0.76, 0.8, THREE.SRGBColorSpace);
const EDGE_AUTO_LIMIT = 800000;

const settings = Object.assign(
	{ edges: true, dims: true, shadows: true, grid: false, ortho: false, props: true, quality: 'normal', density: '7.85', mode: 'real' },
	safeJson(lsGet('mvSettings')));
function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeJson(s) { try { return JSON.parse(s) || {}; } catch { return {}; } }
function saveSettings() { try { localStorage.setItem('mvSettings', JSON.stringify(settings)); } catch { } }

// =====================================================================
// Сцена
// =====================================================================
const canvas = $('canvas');
const viewport = $('viewport');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
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
};

// ---- воркер OpenCascade ----
const worker = new Worker('occt-worker.js');
let jobId = 0;
const jobs = new Map();
worker.onmessage = (ev) => {
	const job = jobs.get(ev.data.id);
	if (!job) return;
	jobs.delete(ev.data.id);
	ev.data.error ? job.reject(new Error(ev.data.error)) : job.resolve(ev.data.result);
};
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
		const base = own ? new THREE.Color().setRGB(m.color[0], m.color[1], m.color[2], THREE.SRGBColorSpace) : DEFAULT_COLOR;
		const col = new Float32Array(pos.length);
		for (let k = 0; k < col.length; k += 3) { col[k] = base.r; col[k + 1] = base.g; col[k + 2] = base.b; }
		let faceColors = false;
		if (idx && m.brep_faces) {
			const c = new THREE.Color();
			for (const f of m.brep_faces) {
				if (!f.color) continue;
				faceColors = true;
				c.setRGB(f.color[0], f.color[1], f.color[2], THREE.SRGBColorSpace);
				for (let t = f.first; t <= f.last; t++) {
					for (let j = 0; j < 3; j++) {
						const v = idx[t * 3 + j] * 3;
						col[v] = c.r; col[v + 1] = c.g; col[v + 2] = c.b;
					}
				}
			}
		}
		g.setAttribute('color', new THREE.BufferAttribute(col, 3));
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
			grp.add(src.parent ? src.clone() : src);
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
	if (OCCT_FORMATS[ext]) {
		const q = QUALITY[settings.quality] || QUALITY.normal;
		const res = await occtParse(OCCT_FORMATS[ext], buffer, {
			linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', ...q,
		});
		return { object: occtToObject(res, name), yUp: false };
	}
	switch (ext) {
		case 'stl': return { object: geometryToObject(new STLLoader().parse(buffer), name), yUp: false };
		case 'ply': return { object: geometryToObject(new PLYLoader().parse(buffer), name), yUp: false };
		case 'obj': return { object: prepThreeObject(new OBJLoader().parse(new TextDecoder().decode(buffer))), yUp: true };
		case '3mf': return { object: prepThreeObject(new ThreeMFLoader().parse(buffer)), yUp: false };
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
async function openBuffer(name, buffer, opts = {}) {
	const ext = name.split('.').pop().toLowerCase();
	if (!SUPPORTED.includes(ext)) { alert('Формат .' + ext + ' не поддерживается'); return; }
	const token = ++loadToken;
	const t0 = performance.now();
	showLoading(`Открываю ${name}…`);
	const timer = setInterval(() => {
		$('loadingText').textContent = `Открываю ${name}… ${((performance.now() - t0) / 1000).toFixed(1)} с`;
	}, 200);
	try {
		const { object, yUp } = await parseModel(name, buffer);
		if (token !== loadToken) return;
		Object.assign(model, { name, buffer, ext, size: buffer.byteLength, format: detectFormat(ext, buffer) });
		model.loadTime = (performance.now() - t0) / 1000;
		object.name = object.name || name;
		setModel(object, yUp);
		document.title = name + ' — ModelView';
		if (window.pywebview && window.pywebview.api) window.pywebview.api.set_title(document.title);
		if (!opts.noRecent) saveRecent();
	} catch (e) {
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
		if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
	});
}

function setModel(object, yUp) {
	clearMeasure();
	if (model.object) { modelRoot.remove(model.object); disposeObject(model.object); }
	model.object = object;
	model.edgesBuilt = false;
	model.yUp = yUp;
	modelRoot.add(object);
	applyUpAxis();

	model.meshes = [];
	model.triangles = 0;
	object.traverse((o) => {
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
	setView('iso');
	if (sectionOn) setupSection();
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
	const common = { side: THREE.DoubleSide, clippingPlanes: clipping, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 };
	const vc = !!ud.vertexColors;
	const color = vc ? new THREE.Color(0xffffff) : (ud.color || DEFAULT_COLOR).clone();
	let m;
	switch (mode) {
		case 'real': {
			// ненасыщенные (серые/белые) детали показываем как сталь
			const hsl = (ud.color || DEFAULT_COLOR).getHSL({});
			const metal = hsl.s < 0.15 && !ud.map;
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
	sun.castShadow = real && settings.shadows;
	ground.visible = real && settings.shadows;
	grid.visible = settings.grid;

	for (const m of model.meshes) {
		if (!m.isMesh) continue;
		if (m.material) m.material.dispose();
		m.material = makeMaterial(m, mode);
		m.castShadow = real;
		m.renderOrder = mode === 'xray' ? 1 : 0;
	}
	const [ec, eo] = EDGE_STYLE[mode];
	edgeMaterial.color.setHex(ec);
	edgeMaterial.opacity = eo;
	edgeMaterial.depthTest = mode !== 'xray';
	const wantEdges = mode === 'hidden' || mode === 'xray' || (settings.edges && mode !== 'wire');
	if (wantEdges && model.object) ensureEdges(); else setEdgesVisible(false);
	if (selected) highlight(selected.obj, true);
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
function setView(name) { fitTo(model.box, new THREE.Vector3(...VIEWS[name]).normalize()); }
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
	updateOrthoFrustum();
	persp.updateProjectionMatrix();
	controls.target.copy(sphere.center);
	camera.lookAt(sphere.center);
	controls.update();
	requestRender();
}

function setOrtho(on) {
	settings.ortho = on; saveSettings(); syncControls();
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
	const show = settings.dims && !!model.object;
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
	const hasMesh = (o) => { let f = false; o.traverse((c) => { if (c.isMesh || c.isPoints) f = true; }); return f; };
	let count = 0;
	const add = (obj, parentEl, depth) => {
		if (count++ > 6000) return;
		const kids = obj.children.filter((c) => c.name !== '__edges' && hasMesh(c));
		const row = document.createElement('div');
		row.className = 'node';
		row.style.paddingLeft = 4 + depth * 14 + 'px';
		const open = depth < 1;
		row.innerHTML =
			`<span class="tw ${kids.length && open ? 'open' : ''}">${kids.length ? icon('chevRight') : ''}</span>` +
			`<i class="ic">${icon(kids.length || !(obj.isMesh || obj.isPoints) ? 'assembly' : 'part')}</i>` +
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
		if (!o.isMesh) return;
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
	if (!obj || (selected && selected.obj === obj)) { selected = null; updateProps(); requestRender(); return; }
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
	const dens = parseFloat(settings.density) || 7.85;
	const parts = countParts();
	const S = st.size;
	const modelRows = [
		['Имя:', selected ? (selected.obj.name || 'Тело') : model.name],
		['Формат:', model.format],
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
		['Открыт за:', model.loadTime ? model.loadTime.toFixed(2) + ' с' : '—'],
	];
	$('pAnalysis').innerHTML = kv(anRows);
	$('analysisBody').innerHTML = kv(anRows);

	propsText = [...modelRows, ['Центр масс:', `${fix2(st.com.x)}; ${fix2(st.com.y)}; ${fix2(st.com.z)} мм`], ...matRows.slice(-2), ['Площадь:', fmtNum(st.area / 100, 2) + ' см²']]
		.map(([k, v]) => `${k} ${v}`).join('\n');
}
function countLeaves(obj) { let n = 0; obj.traverse((o) => { if (o.isMesh || o.isPoints) n++; }); return n; }
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
	$('cardInfo').innerHTML = `Тип: ${esc(model.format.split(' ')[0])}<br>Размер: ${fmtSize(model.size)}<br>Деталей: ${countParts().parts}<br>Габариты: ${fmtNum(S.x, 1)} x ${fmtNum(S.y, 1)} x ${fmtNum(S.z, 1)} мм`;
	refreshFavButton();
}

// =====================================================================
// Последние файлы и избранное (IndexedDB)
// =====================================================================
const DB_MAX_BUFFER = 150 * 1024 * 1024;
let dbp = null;
function db() {
	if (!dbp) dbp = new Promise((res, rej) => {
		const r = indexedDB.open('modelview', 1);
		r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'key' });
		r.onsuccess = () => res(r.result);
		r.onerror = () => rej(r.error);
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
	sectionUniform.value = sectionOn && $('secFill').checked ? 1 : 0;
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
	setupSection();
}
$$('#secAxis button').forEach((b) => b.onclick = () => {
	secAxis = b.dataset.axis;
	$$('#secAxis button').forEach((x) => x.classList.toggle('on', x === b));
	setupSection();
});
$('secPos').oninput = setupSection;
$('secFlip').onchange = setupSection;
$('secFill').onchange = setupSection;
$('secOn').onchange = (e) => setSection(e.target.checked);

// =====================================================================
// Измерение
// =====================================================================
const measure = { points: [], group: new THREE.Group(), labels: [], last: null };
scene.add(measure.group);
const mPointMat = new THREE.PointsMaterial({ color: 0x4d93ff, size: 10, sizeAttenuation: false, depthTest: false });
const mLineMat = new THREE.LineBasicMaterial({ color: 0x4d93ff, depthTest: false });

function clearMeasure() {
	measure.points = [];
	measure.group.children.slice().forEach((c) => { c.geometry.dispose(); measure.group.remove(c); });
	measure.labels.forEach((l) => l.el.remove());
	measure.labels = [];
	measure.last = null;
	$('measResult').innerHTML = '<div class="muted">Выберите инструмент «Измерение» и кликните две точки на модели</div>';
	requestRender();
}
function addMeasurePoint(p) {
	if (measure.points.length >= 2) clearMeasure();
	measure.points.push(p.clone());
	const pt = new THREE.Points(new THREE.BufferGeometry().setFromPoints([p]), mPointMat);
	pt.renderOrder = 999;
	measure.group.add(pt);
	if (measure.points.length === 2) {
		const [a, b] = measure.points;
		const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), mLineMat);
		ln.renderOrder = 998;
		measure.group.add(ln);
		const inv = new THREE.Matrix4().copy(modelRoot.matrixWorld).invert();
		const d = b.clone().applyMatrix4(inv).sub(a.clone().applyMatrix4(inv));
		const el = document.createElement('div');
		el.className = 'mlabel';
		el.innerHTML = `<b>${fix2(d.length())} мм</b>`;
		$('labels').append(el);
		measure.labels.push({ el, pos: a.clone().add(b).multiplyScalar(0.5) });
		$('measResult').innerHTML = kv([
			['Расстояние:', fix2(d.length()) + ' мм'],
			['ΔX:', fix2(Math.abs(d.x)) + ' мм'], ['ΔY:', fix2(Math.abs(d.y)) + ' мм'], ['ΔZ:', fix2(Math.abs(d.z)) + ' мм'],
		]);
	} else {
		$('measResult').innerHTML = '<div class="muted">Укажите вторую точку</div>';
	}
	requestRender();
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
$$('#measMode button').forEach((b) => b.onclick = () => {
	if (b.dataset.m === 'clear') { clearMeasure(); return; }
	if (b.dataset.m === 'dims') { setOpt('dims', !settings.dims); b.classList.toggle('on', settings.dims); return; }
	setTool('measure');
});

// =====================================================================
// Инструменты
// =====================================================================
function applyToolButtons(c) {
	const L = tool === 'pan' ? THREE.MOUSE.PAN : tool === 'zoom' ? THREE.MOUSE.DOLLY : THREE.MOUSE.ROTATE;
	c.mouseButtons = { LEFT: L, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
}
function setTool(t) {
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
	if (tool === 'measure' && t !== 'measure') clearMeasure();
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
	if (tool === 'measure') { if (h) addMeasurePoint(h.point); return; }
	if (tool === 'hide') { if (h) { if (selected && selected.obj === h.object) select(null); setVisible(h.object, false); } return; }
	select(h ? h.object : null);
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
$('quality').value = settings.quality;
$('quality').onchange = (e) => {
	settings.quality = e.target.value; saveSettings();
	if (model.buffer && OCCT_FORMATS[model.ext]) openBuffer(model.name, model.buffer, { noRecent: true });
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
$('expStl').onclick = () => {
	if (!model.object) return;
	const g = visibleGroup();
	const data = new STLExporter().parse(g, { binary: true });
	download(new Blob([data], { type: 'model/stl' }), baseName() + '.stl');
	disposeObject(g);
};
$('expObj').onclick = () => {
	if (!model.object) return;
	const g = visibleGroup();
	download(new Blob([new OBJExporter().parse(g)], { type: 'text/plain' }), baseName() + '.obj');
	disposeObject(g);
};
function baseName() { return (model.name || 'модель').replace(/\.[^.]+$/, ''); }
function download(blob, name) {
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
$('fileInput').onchange = (e) => { if (e.target.files[0]) openFile(e.target.files[0]); e.target.value = ''; };
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('dropOverlay').hidden = false; });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('dropOverlay').hidden = true; } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
	e.preventDefault(); dragDepth = 0; $('dropOverlay').hidden = true;
	const f = e.dataTransfer.files[0];
	if (f) openFile(f);
});

// ---- клавиатура ----
window.addEventListener('keydown', (e) => {
	if (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'range') return;
	if (e.target.tagName === 'SELECT') return;
	if (e.ctrlKey && e.code === 'KeyO') { e.preventDefault(); $('fileInput').click(); return; }
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
		Escape: () => { clearMeasure(); select(null); if (tool !== 'rotate') setTool('rotate'); },
	};
	if (map[e.code]) { e.preventDefault(); map[e.code](); }
});

// =====================================================================
// Утилиты
// =====================================================================
function showLoading(t) { $('loadingText').textContent = t; $('loading').hidden = false; }
function hideLoading() { $('loading').hidden = true; }
function fix2(v) { return (Math.abs(v) < 0.005 ? 0 : v).toFixed(2); }
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

// =====================================================================
// Связь с локальным сервером
// =====================================================================
if (location.protocol.startsWith('http')) {
	fetch('api/initial').then((r) => r.json()).then(async (info) => {
		if (!info.name) return;
		showLoading(`Читаю ${info.name}…`);
		const buf = await (await fetch('api/file')).arrayBuffer();
		openBuffer(info.name, buf);
	}).catch(() => { });
}

toggleProps(settings.props);
syncControls();
applyMode();
resize();
updateProps();
