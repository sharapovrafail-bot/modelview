// Экспорт RafCAD View: «Сохранить как» (исходный файл) и запись в распространённые форматы.
// 3D: STL (двоичный и текстовый), OBJ, PLY, GLB (glTF 2.0), 3MF.
// 2D-чертёж: DXF (AutoCAD R12 — откроет любая CAD), SVG, PDF (вектор), PNG/JPG.
// STEP/IGES/DWG программа записать не может: OpenCascade здесь только читает. Поэтому для них —
// «Сохранить как» копирует исходный файл, а геометрия STEP/IGES/BREP выгружается сеткой (STL, 3MF, GLB…).
import * as THREE from 'three';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { PLYExporter } from 'three/addons/exporters/PLYExporter.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import * as fflate from 'three/addons/libs/fflate.module.js';

export const FORMATS3D = [
	{ id: 'stl', ext: 'stl', name: 'STL — двоичный (3D-печать, CAM)' },
	{ id: 'stla', ext: 'stl', name: 'STL — текстовый (ASCII)' },
	{ id: 'obj', ext: 'obj', name: 'OBJ (Wavefront)' },
	{ id: '3mf', ext: '3mf', name: '3MF (слайсеры: Bambu, Orca, Prusa, Cura)' },
	{ id: 'glb', ext: 'glb', name: 'GLB / glTF 2.0 (с цветами, для просмотра и веба)' },
	{ id: 'ply', ext: 'ply', name: 'PLY — двоичный' },
];
export const FORMATS2D = [
	{ id: 'dxf', ext: 'dxf', name: 'DXF (AutoCAD R12 — откроет любая CAD/CAM)' },
	{ id: 'svg', ext: 'svg', name: 'SVG (вектор, для браузера и графики)' },
	{ id: 'pdf', ext: 'pdf', name: 'PDF (вектор, в масштабе 1:1 или по листу)' },
];
export const FORMATSIMG = [
	{ id: 'png', ext: 'png', name: 'PNG — снимок экрана' },
	{ id: 'jpg', ext: 'jpg', name: 'JPG — снимок экрана' },
];

// ------------------------------------------------------------------ 3D
// group — группа мешей в координатах модели (мм), как visibleGroup() в viewer.js
export async function export3d(fmt, group) {
	switch (fmt) {
		case 'stl': return new Blob([new STLExporter().parse(group, { binary: true })], { type: 'model/stl' });
		case 'stla': return new Blob([new STLExporter().parse(group, { binary: false })], { type: 'model/stl' });
		case 'obj': return new Blob([new OBJExporter().parse(group)], { type: 'text/plain' });
		case 'ply': return new Promise((res) => new PLYExporter().parse(group, (d) => res(new Blob([d], { type: 'application/octet-stream' })), { binary: true }));
		case 'glb': {
			// glTF по стандарту — метры и ось Y вверх: модель (мм, Z вверх) поворачиваем и масштабируем
			const root = new THREE.Group(); root.name = 'RafCAD View';
			root.rotation.x = -Math.PI / 2; root.scale.setScalar(0.001);
			const kids = [...group.children]; kids.forEach((c) => root.add(c));
			try { return await new Promise((res, rej) => new GLTFExporter().parse(root, (d) => res(new Blob([d], { type: 'model/gltf-binary' })), rej, { binary: true })); }
			finally { kids.forEach((c) => group.add(c)); }
		}
		case '3mf': return new Blob([write3mf(group)], { type: 'model/3mf' });
	}
	throw new Error('Неизвестный формат ' + fmt);
}

function meshesOf(group) {
	const out = [];
	group.updateMatrixWorld(true);
	group.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.attributes.position) out.push(o); });
	return out;
}

// 3MF (Core spec): каждая деталь — отдельный object, единицы — мм, цвет — basematerials
export function write3mf(group) {
	const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	const fx = (v) => (Math.round(v * 1e5) / 1e5).toString();
	const parts = [], mats = [];
	let id = 2; // 1 — basematerials
	for (const m of meshesOf(group)) {
		const g = m.geometry.index ? m.geometry : m.geometry; const pos = g.attributes.position, idx = g.index;
		const v = new THREE.Vector3(), verts = [];
		for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); verts.push(`<vertex x="${fx(v.x)}" y="${fx(v.y)}" z="${fx(v.z)}"/>`); }
		const tris = [], n = idx ? idx.count : pos.count;
		for (let i = 0; i + 2 < n; i += 3) {
			const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
			if (a !== b && b !== c && a !== c) tris.push(`<triangle v1="${a}" v2="${b}" v3="${c}"/>`);
		}
		if (!tris.length) continue;
		const col = m.material && m.material.color ? '#' + m.material.color.getHexString().toUpperCase() : '#BCC2CC';
		let mi = mats.indexOf(col); if (mi < 0) { mats.push(col); mi = mats.length - 1; }
		parts.push({ id: id++, name: m.name || 'Деталь ' + (parts.length + 1), mi, xml: `<mesh><vertices>${verts.join('')}</vertices><triangles>${tris.join('')}</triangles></mesh>` });
	}
	if (!parts.length) throw new Error('Нет видимых деталей для записи');
	const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="ru-RU" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Application">RafCAD View</metadata>
<resources><basematerials id="1">${mats.map((c, i) => `<base name="Цвет ${i + 1}" displaycolor="${c}"/>`).join('')}</basematerials>
${parts.map((p) => `<object id="${p.id}" type="model" name="${esc(p.name)}" pid="1" pindex="${p.mi}">${p.xml}</object>`).join('\n')}
</resources>
<build>${parts.map((p) => `<item objectid="${p.id}"/>`).join('')}</build>
</model>`;
	const enc = new TextEncoder();
	return fflate.zipSync({
		'[Content_Types].xml': enc.encode('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'),
		'_rels/.rels': enc.encode('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),
		'3D/3dmodel.model': enc.encode(model),
	}, { level: 6 });
}

// ------------------------------------------------------------------ 2D
// Собирает видимые линии и надписи 2D-чертежа в координатах чертежа (мм).
// root — model.object (корень чертежа из cad2d.buildDrawing), isShown — функция видимости из viewer.js
export function collect2d(root, isShown) {
	root.updateMatrixWorld(true);
	const toDoc = new THREE.Matrix4().copy(root.matrixWorld).invert();
	const segs = [], texts = [], layers = new Map();
	const v = new THREE.Vector3(), m = new THREE.Matrix4();
	root.traverse((o) => {
		if (!isShown(o)) return;
		const layer = layerOf(o);
		if (o.isLineSegments && o.geometry) {
			m.multiplyMatrices(toDoc, o.matrixWorld);
			const p = o.geometry.attributes.position, col = (o.userData.color || o.material.color).getHex();
			if (!layers.has(layer)) layers.set(layer, col);
			for (let i = 0; i + 1 < p.count; i += 2) {
				v.fromBufferAttribute(p, i).applyMatrix4(m); const x1 = v.x, y1 = v.y;
				v.fromBufferAttribute(p, i + 1).applyMatrix4(m);
				segs.push({ x1, y1, x2: v.x, y2: v.y, color: col, layer });
			}
		} else if (o.isMesh && o.userData.textInfo) {
			m.multiplyMatrices(toDoc, o.matrixWorld);
			const e = m.elements, sx = Math.hypot(e[0], e[1]) || 1;
			const t = o.userData.textInfo;
			if (!layers.has(layer)) layers.set(layer, t.color);
			texts.push({ x: e[12], y: e[13], rot: Math.atan2(e[1], e[0]), h: t.h * sx, lines: t.lines, ha: t.ha || 0, vRef: t.vRef, color: t.color, layer });
		}
	});
	let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
	const ext = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
	for (const s of segs) { ext(s.x1, s.y1); ext(s.x2, s.y2); }
	for (const t of texts) ext(t.x, t.y);
	if (!isFinite(x0)) throw new Error('В чертеже нет видимых линий');
	return { segs, texts, layers, box: { x0, y0, x1, y1 } };
}
function layerOf(o) {
	while (o) { if (o.userData && o.userData.dxfLayer) return o.name || '0'; o = o.parent; }
	return '0';
}

// ближайший цвет AutoCAD (ACI 1…255) к RGB
let ACI = null;
function aciTable() {
	if (ACI) return ACI;
	ACI = [];
	const base = [[255, 0, 0], [255, 255, 0], [0, 255, 0], [0, 255, 255], [0, 0, 255], [255, 0, 255], [255, 255, 255], [128, 128, 128], [192, 192, 192]];
	base.forEach((c, i) => ACI[i + 1] = c);
	for (let i = 10; i < 250; i++) {
		const hue = Math.floor((i - 10) / 10) * 15, k = (i - 10) % 10, sat = k % 2 ? 0.5 : 1, val = [1, 1, 0.8, 0.8, 0.6, 0.6, 0.5, 0.5, 0.3, 0.3][k];
		const c = new THREE.Color().setHSL(hue / 360, 1, 0.5); const r = [c.r, c.g, c.b].map((x) => Math.round(255 * val * (sat * x + (1 - sat))));
		ACI[i] = r;
	}
	[33, 66, 99, 132, 165, 198].forEach((g, j) => ACI[250 + j] = [g + 18, g + 18, g + 18].map((x) => Math.min(255, x)));
	return ACI;
}
function aciOf(hex) {
	const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255, T = aciTable();
	// белый и чёрный — ACI 7 (в CAD он белый на тёмном фоне и чёрный на светлом)
	if (r + g + b > 700 || r + g + b < 60) return 7;
	let best = 7, bd = Infinity;
	for (let i = 1; i < T.length; i++) { const c = T[i]; if (!c) continue; const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2; if (d < bd) { bd = d; best = i; } }
	return best;
}
const dxfName = (s) => String(s || '0').replace(/[<>\/\\":;?*|=,`]/g, '_').slice(0, 31) || '0';

// DXF R12 (AC1009) — самый совместимый вариант: LINE и TEXT по слоям, цвет — у слоя и у примитива
export function writeDxf(d) {
	const L = [], g = (c, v) => { L.push(String(c)); L.push(String(v)); };
	const n = (x) => (Math.round(x * 1e6) / 1e6).toString();
	g(0, 'SECTION'); g(2, 'HEADER');
	g(9, '$ACADVER'); g(1, 'AC1009');
	g(9, '$DWGCODEPAGE'); g(3, 'ANSI_1251');
	g(9, '$INSUNITS'); g(70, 4);
	g(9, '$EXTMIN'); g(10, n(d.box.x0)); g(20, n(d.box.y0)); g(30, 0);
	g(9, '$EXTMAX'); g(10, n(d.box.x1)); g(20, n(d.box.y1)); g(30, 0);
	g(0, 'ENDSEC');
	g(0, 'SECTION'); g(2, 'TABLES');
	g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 1);
	g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, 0);
	g(0, 'ENDTAB');
	const names = [...d.layers.keys()];
	if (!names.includes('0')) names.unshift('0');
	g(0, 'TABLE'); g(2, 'LAYER'); g(70, names.length);
	for (const nm of names) { g(0, 'LAYER'); g(2, dxfName(nm)); g(70, 0); g(62, d.layers.has(nm) ? aciOf(d.layers.get(nm)) : 7); g(6, 'CONTINUOUS'); }
	g(0, 'ENDTAB');
	g(0, 'TABLE'); g(2, 'STYLE'); g(70, 1);
	g(0, 'STYLE'); g(2, 'STANDARD'); g(70, 0); g(40, 0); g(41, 1); g(50, 0); g(71, 0); g(42, 2.5); g(3, 'txt'); g(4, '');
	g(0, 'ENDTAB');
	g(0, 'ENDSEC');
	g(0, 'SECTION'); g(2, 'ENTITIES');
	for (const s of d.segs) {
		if (Math.abs(s.x1 - s.x2) < 1e-9 && Math.abs(s.y1 - s.y2) < 1e-9) continue;
		g(0, 'LINE'); g(8, dxfName(s.layer)); g(62, aciOf(s.color));
		g(10, n(s.x1)); g(20, n(s.y1)); g(30, 0); g(11, n(s.x2)); g(21, n(s.y2)); g(31, 0);
	}
	const LS = 1.6; // межстрочный интервал в высотах букв
	for (const t of d.texts) {
		const ca = Math.cos(t.rot), sa = Math.sin(t.rot);
		t.lines.forEach((line, i) => {
			if (!line.trim()) return;
			const dy = -i * t.h * LS, px = t.x - sa * dy, py = t.y + ca * dy;
			g(0, 'TEXT'); g(8, dxfName(t.layer)); g(62, aciOf(t.color));
			g(10, n(px)); g(20, n(py)); g(30, 0); g(40, n(t.h)); g(1, line.replace(/\r?\n/g, ' '));
			if (t.rot) g(50, n(t.rot * 180 / Math.PI));
			if (t.ha) { g(72, t.ha); g(11, n(px)); g(21, n(py)); g(31, 0); }
		});
	}
	g(0, 'ENDSEC'); g(0, 'EOF');
	// AutoCAD R12 ждёт текст в кодировке Windows-1251 для русских надписей
	return encode1251(L.join('\r\n') + '\r\n');
}
function encode1251(s) {
	const out = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c < 128) out[i] = c;
		else if (c >= 0x410 && c <= 0x44F) out[i] = c - 0x350;
		else if (c === 0x401) out[i] = 0xA8; else if (c === 0x451) out[i] = 0xB8;
		else if (c === 0xB0) out[i] = 0xB0; else if (c === 0xB1) out[i] = 0xB1; else if (c === 0x2116) out[i] = 0xB9;
		else out[i] = 63;
	}
	return out;
}

const svgEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// белые и почти белые линии (цвет ACI 7 на тёмном фоне) на белом листе рисуются чёрными
export const isWhite = (h) => ((h >> 16) & 255) > 0xe0 && ((h >> 8) & 255) > 0xe0 && (h & 255) > 0xe0;
const hexCss = (h, bg) => (bg === 'white' && isWhite(h)) ? '#000000' : '#' + h.toString(16).padStart(6, '0');

// SVG в миллиметрах (1 единица = 1 мм), белый фон, белые линии рисуются чёрными
export function writeSvg(d) {
	const pad = 5, { x0, y0, x1, y1 } = d.box, w = x1 - x0 + 2 * pad, h = y1 - y0 + 2 * pad;
	const X = (x) => (x - x0 + pad).toFixed(4), Y = (y) => (y1 - y + pad).toFixed(4);
	const byColor = new Map();
	for (const s of d.segs) { const c = hexCss(s.color, 'white'); (byColor.get(c) || byColor.set(c, []).get(c)).push(`M${X(s.x1)} ${Y(s.y1)}L${X(s.x2)} ${Y(s.y2)}`); }
	const sw = Math.max(w, h) / 2000;
	let out = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${w.toFixed(3)}mm" height="${h.toFixed(3)}mm" viewBox="0 0 ${w.toFixed(3)} ${h.toFixed(3)}">\n<!-- RafCAD View -->\n<rect width="100%" height="100%" fill="#fff"/>\n<g fill="none" stroke-linecap="round" stroke-width="${sw.toFixed(4)}">\n`;
	for (const [c, ps] of byColor) out += `<path stroke="${c}" d="${ps.join('')}"/>\n`;
	out += '</g>\n<g font-family="Arial, sans-serif">\n';
	for (const t of d.texts) {
		const anchor = ['start', 'middle', 'end'][t.ha] || 'start';
		const deg = (-t.rot * 180 / Math.PI).toFixed(3);
		t.lines.forEach((line, i) => {
			out += `<text x="${X(t.x)}" y="${Y(t.y)}" font-size="${(t.h * 1.4).toFixed(3)}" fill="${hexCss(t.color, 'white')}" text-anchor="${anchor}" transform="rotate(${deg} ${X(t.x)} ${Y(t.y)}) translate(0 ${(i * t.h * 1.6).toFixed(3)})">${svgEsc(line)}</text>\n`;
		});
	}
	out += '</g>\n</svg>\n';
	return new Blob([out], { type: 'image/svg+xml' });
}

// PDF: по листу A4…A0 (сам выбирает, чтобы влезло в 1:1, иначе вписывает в A3) — векторные линии
export function writePdf(d, title) {
	const { x0, y0, x1, y1 } = d.box, w = x1 - x0, h = y1 - y0, m = 10;
	const sizes = [['a4', 297, 210], ['a3', 420, 297], ['a2', 594, 420], ['a1', 841, 594], ['a0', 1189, 841]];
	let pick = sizes.find(([, W, H]) => w + 2 * m <= W && h + 2 * m + 8 <= H) || sizes[1];
	const [fmt, W, H] = pick, k = Math.min(1, (W - 2 * m) / w, (H - 2 * m - 8) / h);
	const pdf = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: fmt, compress: true });
	const ox = (W - w * k) / 2, oy = (H - 8 - h * k) / 2 + 8;
	const X = (x) => ox + (x - x0) * k, Y = (y) => oy + (y1 - y) * k;
	pdf.setLineWidth(0.18);
	let cur = -1;
	for (const s of d.segs) {
		const c = isWhite(s.color) ? 0 : s.color;
		if (c !== cur) { pdf.setDrawColor((c >> 16) & 255, (c >> 8) & 255, c & 255); cur = c; }
		pdf.line(X(s.x1), Y(s.y1), X(s.x2), Y(s.y2));
	}
	// надписи — картинкой (встроенный шрифт jsPDF не знает кириллицы), до 1500 строк
	const cv = document.createElement('canvas'), ctx = cv.getContext('2d'), PX = 64;
	let nt = 0;
	for (const t of d.texts) for (let i = 0; i < t.lines.length && nt < 1500; i++) {
		const line = t.lines[i]; if (!line.trim()) continue; nt++;
		ctx.font = `${PX}px Arial`; const tw = ctx.measureText(line).width;
		cv.width = Math.ceil(tw) + 4; cv.height = Math.ceil(PX * 1.3);
		ctx.font = `${PX}px Arial`; const c = isWhite(t.color) ? 0 : t.color;
		ctx.fillStyle = '#' + c.toString(16).padStart(6, '0'); ctx.textBaseline = 'alphabetic';
		ctx.fillText(line, 2, PX);
		const hmm = t.h * 1.4 * k, wmm = hmm * cv.width / PX, imH = hmm * cv.height / PX;
		const al = [0, 0.5, 1][t.ha] || 0, ca = Math.cos(t.rot), sa = Math.sin(t.rot);
		// базовая линия строки i в мм листа; сдвиг до верхнего левого угла картинки
		const bx = X(t.x) + sa * i * t.h * 1.6 * k, by = Y(t.y) + ca * i * t.h * 1.6 * k;
		const dx = -al * wmm, dy = -hmm;
		const px = bx + dx * ca + dy * sa, py = by - dx * sa + dy * ca;
		try { pdf.addImage(cv.toDataURL('image/png'), 'PNG', px, py, wmm, imH, undefined, 'FAST', t.rot * 180 / Math.PI); } catch { }
	}
	// подпись листа (латиница и цифры — шрифт jsPDF без кириллицы)
	pdf.setFontSize(9); pdf.setTextColor(90);
	pdf.text(`RafCAD View  |  ${k === 1 ? 'M 1:1' : 'M 1:' + (1 / k).toFixed(2)}  |  ${w.toFixed(1)} x ${h.toFixed(1)} mm`, m, 6);
	return pdf.output('blob');
}
