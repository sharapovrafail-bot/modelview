// Чертежи 2D: DXF и DWG -> объекты three.js (вид сверху, плоскость XY, мм).
// DXF разбирает dxf-parser (MIT, lib/dxf-parser), DWG — LibreDWG в WebAssembly
// (GPL-3.0, lib/libredwg; грузится только при открытии DWG).
// Оба формата сначала приводятся к одному простому описанию (normDoc), его рисует buildDrawing.
import * as THREE from 'three';

// палитра AutoCAD (ACI), индексы 0..255
const ACI = '0,ff0000,ffff00,ff00,ffff,ff,ff00ff,ffffff,808080,c0c0c0,ff0000,ff7f7f,cc0000,cc6666,990000,994c4c,7f0000,7f3f3f,4c0000,4c2626,ff3f00,ff9f7f,cc3300,cc7f66,992600,995f4c,7f1f00,7f4f3f,4c1300,4c2f26,ff7f00,ffbf7f,cc6600,cc9966,994c00,99724c,7f3f00,7f5f3f,4c2600,4c3926,ffbf00,ffdf7f,cc9900,ccb266,997200,99854c,7f5f00,7f6f3f,4c3900,4c4226,ffff00,ffff7f,cccc00,cccc66,989800,98984c,7f7f00,7f7f3f,4c4c00,4c4c26,bfff00,dfff7f,99cc00,b2cc66,729800,85984c,5f7f00,6f7f3f,394c00,424c26,7fff00,bfff7f,66cc00,99cc66,4c9800,72984c,3f7f00,5f7f3f,264c00,394c26,3fff00,9fff7f,33cc00,7fcc66,269800,5f984c,1f7f00,4f7f3f,134c00,2f4c26,ff00,7fff7f,cc00,66cc66,9800,4c984c,7f00,3f7f3f,4c00,264c26,ff3f,7fff9f,cc33,66cc7f,9826,4c985f,7f1f,3f7f4f,4c13,264c2f,ff7f,7fffbf,cc66,66cc99,984c,4c9872,7f3f,3f7f5f,4c26,264c39,ffbf,7fffdf,cc99,66ccb2,9872,4c9885,7f5f,3f7f6f,4c39,264c42,ffff,7fffff,cccc,66cccc,9898,4c9898,7f7f,3f7f7f,4c4c,264c4c,bfff,7fdfff,99cc,66b2cc,7298,4c8598,5f7f,3f6f7f,394c,26424c,7fff,7fbfff,66cc,6699cc,4c98,4c7298,3f7f,3f5f7f,264c,26394c,3fff,7f9fff,33cc,667fcc,2698,4c5f98,1f7f,3f4f7f,134c,262f4c,ff,7f7fff,cc,6666cc,98,4c4c98,7f,3f3f7f,4c,26264c,3f00ff,9f7fff,3300cc,7f66cc,260098,5f4c98,1f007f,4f3f7f,13004c,2f264c,7f00ff,bf7fff,6600cc,9966cc,4c0098,724c98,3f007f,5f3f7f,26004c,39264c,bf00ff,df7fff,9900cc,b266cc,720098,854c98,5f007f,6f3f7f,39004c,42264c,ff00ff,ff7fff,cc00cc,cc66cc,980098,984c98,7f007f,7f3f7f,4c004c,4c264c,ff00bf,ff7fdf,cc0099,cc66b2,980072,984c85,7f005f,7f3f6f,4c0039,4c2642,ff007f,ff7fbf,cc0066,cc6699,98004c,984c72,7f003f,7f3f5f,4c0026,4c2639,ff003f,ff7f9f,cc0033,cc667f,980026,984c5f,7f001f,7f3f4f,4c0013,4c262f,333333,5b5b5b,848484,adadad,d6d6d6,ffffff'.split(',').map((h) => parseInt(h, 16));
const UNITS_MM = { 0: 1, 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 8: 0.0254, 9: 0.0254, 10: 914.4, 14: 100, 15: 1000 };
const UNITS_NAME = { 0: 'не заданы (считаем мм)', 1: 'дюймы', 2: 'футы', 4: 'мм', 5: 'см', 6: 'м', 8: 'микродюймы', 9: 'милы', 10: 'ярды', 14: 'дм', 15: 'дам' };
const D2R = Math.PI / 180;
const MAX_TEXTS = 4000;
const MAX_DEPTH = 12;

// =====================================================================
// Чтение файла
// =====================================================================
export async function readDrawing(ext, buffer) {
	if (ext === 'dwg') return readDwg(buffer);
	return readDxf(buffer);
}

// ---------------- DXF ----------------
let DxfParserCls = null;
async function dxfParser() {
	if (!DxfParserCls) {
		await import('./lib/dxf-parser/dxf-parser.js'); // UMD: кладёт класс в self.DxfParser
		DxfParserCls = self.DxfParser.default || self.DxfParser.DxfParser || self.DxfParser;
	}
	const p = new DxfParserCls();
	// ATTRIB и HATCH dxf-parser не читает — забираем их «сырыми» парами кодов
	for (const name of ['ATTRIB', 'HATCH']) p.registerEntityHandler(class {
		constructor() { this.ForEntityName = name; }
		parseEntity(scanner, curr) {
			const e = { type: curr.value, raw: [] };
			curr = scanner.next();
			while (!scanner.isEOF() && curr.code !== 0) { e.raw.push([curr.code, curr.value]); curr = scanner.next(); }
			return e;
		}
	});
	return p;
}

const CODEPAGES = {
	ANSI_874: 'windows-874', ANSI_932: 'shift_jis', ANSI_936: 'gbk', ANSI_949: 'euc-kr', ANSI_950: 'big5',
	ANSI_1250: 'windows-1250', ANSI_1251: 'windows-1251', ANSI_1252: 'windows-1252', ANSI_1253: 'windows-1253',
	ANSI_1254: 'windows-1254', ANSI_1255: 'windows-1255', ANSI_1256: 'windows-1256', ANSI_1257: 'windows-1257',
	ANSI_1258: 'windows-1258', DOS866: 'ibm866',
};
function decodeDxf(buffer) {
	const u8 = new Uint8Array(buffer);
	const head = new TextDecoder('latin1').decode(u8.subarray(0, Math.min(u8.length, 65536)));
	if (head.startsWith('AutoCAD Binary DXF')) throw new Error('Двоичный DXF не поддерживается — сохраните чертёж как обычный (текстовый) DXF.');
	const ver = (/\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*(AC\d+)/i.exec(head) || [])[1] || '';
	const cp = ((/\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*(\S+)/i.exec(head) || [])[1] || '').toUpperCase();
	if (ver >= 'AC1021') return { text: new TextDecoder('utf-8').decode(u8), ver };
	// до AutoCAD 2007 текст хранится в кодировке Windows; если не указана — пробуем UTF-8, затем 1251
	if (CODEPAGES[cp]) { try { return { text: new TextDecoder(CODEPAGES[cp]).decode(u8), ver }; } catch { } }
	try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(u8), ver }; }
	catch { return { text: new TextDecoder('windows-1251').decode(u8), ver }; }
}

async function readDxf(buffer) {
	const { text, ver } = decodeDxf(buffer);
	const p = await dxfParser();
	let dxf;
	try { dxf = p.parseSync(text.replace(/^﻿/, '')); }
	catch (e) { throw new Error('Файл DXF повреждён или не читается: ' + (e.message || e)); }
	if (!dxf) throw new Error('Пустой файл DXF');
	const hdr = dxf.header || {};
	const doc = newDoc('DXF', ver || hdr.$ACADVER, hdr.$INSUNITS);
	const lt = dxf.tables && dxf.tables.layer && dxf.tables.layer.layers;
	if (lt) for (const [name, l] of Object.entries(lt)) doc.layers[name] = { aci: l.colorIndex, visible: l.visible !== false && !l.frozen };
	for (const [name, b] of Object.entries(dxf.blocks || {})) {
		doc.blocks[name.toUpperCase()] = { base: pt(b.position), ents: normList(b.entities || [], normDxf) };
	}
	doc.ents = normList((dxf.entities || []).filter((e) => !e.inPaperSpace), normDxf);
	return doc;
}

// ---------------- DWG ----------------
let libredwg = null;
async function dwgLib() {
	if (!libredwg) {
		const mod = await import('./lib/libredwg/dist/libredwg-web.js');
		const base = new URL('./lib/libredwg/wasm/', import.meta.url).href;
		libredwg = { mod, lib: await mod.LibreDwg.create(base) };
	}
	return libredwg;
}
async function readDwg(buffer) {
	const { mod, lib } = await dwgLib();
	const u8 = new Uint8Array(buffer);
	const sig = new TextDecoder('latin1').decode(u8.subarray(0, 6));
	if (!/^AC10\d\d$/.test(sig)) throw new Error('Это не файл DWG (нет подписи AutoCAD)');
	let db;
	try {
		const dwg = lib.dwg_read_data(u8, mod.Dwg_File_Type.DWG);
		if (!dwg) throw new Error('не удалось прочитать');
		try { db = lib.convert(dwg); } finally { try { lib.dwg_free(dwg); } catch { } }
	} catch (e) {
		throw new Error(`Не удалось прочитать DWG (${dwgVersion(sig)}): ${e.message || e}`);
	}
	const hdr = db.header || {};
	const doc = newDoc('DWG', sig, hdr.INSUNITS);
	doc.versionName = dwgVersion(sig);
	for (const l of (db.tables && db.tables.LAYER && db.tables.LAYER.entries) || []) {
		doc.layers[l.name] = { aci: l.colorIndex, visible: !l.frozen && !l.off && (l.colorIndex == null || l.colorIndex >= 0) };
	}
	let model = null;
	for (const b of (db.tables && db.tables.BLOCK_RECORD && db.tables.BLOCK_RECORD.entries) || []) {
		const name = String(b.name || '');
		if (/^\*MODEL_SPACE$/i.test(name)) { model = b; continue; }
		if (/^\*PAPER_SPACE/i.test(name)) continue;
		doc.blocks[name.toUpperCase()] = { base: pt(b.basePoint), ents: normList(b.entities || [], normDwg) };
	}
	const ents = model && model.entities && model.entities.length ? model.entities : (db.entities || []).filter((e) => !e.isInPaperSpace);
	doc.ents = normList(ents, normDwg);
	return doc;
}
function dwgVersion(sig) {
	return ({ AC1012: 'R13', AC1014: 'R14', AC1015: '2000', AC1018: '2004', AC1021: '2007', AC1024: '2010', AC1027: '2013', AC1032: '2018' })[sig] || sig;
}

// =====================================================================
// Приведение к общему виду
// =====================================================================
function newDoc(format, version, insunits) {
	const u = insunits | 0;
	return { format, version: version || '', units: u, scale: UNITS_MM[u] || 1, unitsName: UNITS_NAME[u] || 'код ' + u, layers: {}, blocks: {}, ents: [] };
}
function pt(p) { return p ? { x: +p.x || 0, y: +p.y || 0 } : { x: 0, y: 0 }; }
function normList(list, fn) {
	const out = [];
	const ok = (q) => q && Number.isFinite(q.x) && Number.isFinite(q.y);
	for (const e of list) {
		try {
			const n = fn(e);
			if (!n) continue;
			if (n.pts) n.pts = n.pts.filter(ok); // у 3DFACE из dxf-parser бывает пустая 4-я вершина
			if (n.loops) n.loops = n.loops.map((l) => l.filter(ok));
			out.push(n);
		} catch { }
	}
	return out;
}
function common(e, t) {
	const ext = e.extrusionDirection;
	const ez = ext ? ext.z : e.extrusionDirectionZ;
	return { t, layer: e.layer == null ? '0' : String(e.layer), aci: e.colorIndex, flip: ez != null && ez < -0.5, hidden: e.visible === false || e.isVisible === false };
}

// ---- DXF (dxf-parser) ----
function normDxf(e) {
	switch (e.type) {
		case 'LINE': return e.vertices && e.vertices.length > 1 ? { ...common(e, 'LINE'), a: pt(e.vertices[0]), b: pt(e.vertices[1]) } : null;
		case 'CIRCLE': return { ...common(e, 'CIRCLE'), c: pt(e.center), r: e.radius };
		case 'ARC': return { ...common(e, 'ARC'), c: pt(e.center), r: e.radius, a0: e.startAngle, a1: e.endAngle };
		case 'ELLIPSE': return { ...common(e, 'ELLIPSE'), c: pt(e.center), m: pt(e.majorAxisEndPoint), ratio: e.axisRatio, a0: e.startAngle || 0, a1: e.endAngle == null ? Math.PI * 2 : e.endAngle };
		case 'LWPOLYLINE':
		case 'POLYLINE':
			if (e.isPolyfaceMesh || e.is3dPolygonMesh) return null;
			return { ...common(e, 'POLY'), pts: (e.vertices || []).map((v) => ({ x: v.x, y: v.y, b: v.bulge || 0 })), closed: !!e.shape };
		case 'SPLINE':
			return { ...common(e, 'SPLINE'), deg: e.degreeOfSplineCurve || 3, ctrl: (e.controlPoints || []).map(pt), knots: e.knotValues || [], w: null, fit: (e.fitPoints || []).map(pt), closed: !!e.closed };
		case 'TEXT':
			return { ...common(e, 'TEXT'), p: pt(e.startPoint), p2: e.endPoint ? pt(e.endPoint) : null, h: e.textHeight || 1, rot: (e.rotation || 0) * D2R, s: e.text || '', ha: e.halign || 0, va: e.valign || 0, wf: e.xScale || 1 };
		case 'MTEXT': {
			const dv = e.directionVector;
			const rot = dv && (dv.x || dv.y) ? Math.atan2(dv.y, dv.x) : (e.rotation || 0) * D2R;
			return { ...common(e, 'MTEXT'), p: pt(e.position), h: e.height || 1, rot, s: e.text || '', attach: e.attachmentPoint || 1 };
		}
		case 'INSERT':
			return { ...common(e, 'INSERT'), name: String(e.name || '').toUpperCase(), p: pt(e.position), sx: e.xScale == null ? 1 : e.xScale, sy: e.yScale == null ? 1 : e.yScale, rot: (e.rotation || 0) * D2R, cols: e.columnCount || 1, rows: e.rowCount || 1, dc: e.columnSpacing || 0, dr: e.rowSpacing || 0 };
		case 'DIMENSION': return e.block ? { ...common(e, 'INSERT'), name: String(e.block).toUpperCase(), p: { x: 0, y: 0 }, sx: 1, sy: 1, rot: 0, cols: 1, rows: 1, dc: 0, dr: 0, dim: true, flip: false } : null;
		case 'SOLID': return e.points && e.points.length >= 3 ? { ...common(e, 'FILL'), pts: solidPts(e.points.map(pt)) } : null;
		case '3DFACE': return e.vertices && e.vertices.length >= 3 ? { ...common(e, 'POLY'), pts: e.vertices.map((v) => ({ x: v.x, y: v.y, b: 0 })), closed: true, flip: false } : null;
		case 'ATTRIB': return rawAttrib(e);
		case 'HATCH': return rawHatch(e);
	}
	return null;
}
function solidPts(p) { return p.length === 4 ? [p[0], p[1], p[3], p[2]] : p.slice(0, 3); }

// ATTRIB из «сырых» пар кодов
function rawCommon(raw, t) {
	const o = { t, layer: '0', aci: undefined, flip: false, hidden: false, paper: false };
	for (const [c, v] of raw) {
		if (c === 8) o.layer = String(v); else if (c === 62) o.aci = v; else if (c === 67) o.paper = v !== 0;
		else if (c === 60) o.hidden = v !== 0; else if (c === 230 && v < -0.5) o.flip = true;
	}
	return o;
}
function rawAttrib(e) {
	const o = rawCommon(e.raw, 'TEXT');
	if (o.paper) return null;
	let p = { x: 0, y: 0 }, p2 = null, h = 1, rot = 0, s = '', ha = 0, va = 0, wf = 1, flags = 0;
	for (const [c, v] of e.raw) {
		if (c === 10) p = { x: v, y: p.y }; else if (c === 20) p.y = v;
		else if (c === 11) p2 = { x: v, y: 0 }; else if (c === 21 && p2) p2.y = v;
		else if (c === 40) h = v; else if (c === 50) rot = v * D2R; else if (c === 1) s = String(v);
		else if (c === 72) ha = v; else if (c === 74) va = v; else if (c === 41) wf = v; else if (c === 70) flags = v;
	}
	if (flags & 1) return null; // невидимый атрибут
	return { ...o, p, p2, h, rot, s, ha, va, wf };
}
// HATCH: только контуры — сплошная заливка или полупрозрачная для штриховки
function rawHatch(e) {
	const o = rawCommon(e.raw, 'HATCH');
	if (o.paper) return null;
	const r = e.raw;
	let i = 0;
	const loops = [];
	let solid = false;
	const num = (c) => (r[i] && r[i][0] === c ? r[i++][1] : undefined);
	while (i < r.length) {
		const [c, v] = r[i];
		if (c === 70) { solid = v === 1; i++; continue; }
		if (c !== 92) { i++; continue; }
		const flag = v; i++;
		const loop = [];
		if (flag & 2) { // полилиния
			const pts = [];
			let closed = true;
			while (i < r.length && r[i][0] !== 93) { if (r[i][0] === 73) closed = !!r[i][1]; i++; }
			const n = num(93) || 0;
			for (let k = 0; k < n && i < r.length; k++) {
				while (i < r.length && r[i][0] !== 10) i++;
				const x = num(10), y = num(20);
				const b = r[i] && r[i][0] === 42 ? r[i++][1] : 0;
				pts.push({ x, y, b });
			}
			polyPoints(pts, closed, (x, y) => loop.push({ x, y }));
		} else { // рёбра
			const n = num(93) || 0;
			for (let k = 0; k < n && i < r.length; k++) {
				while (i < r.length && r[i][0] !== 72) i++;
				const type = num(72);
				const val = {};
				while (i < r.length && ![72, 92, 97, 75, 76].includes(r[i][0])) { const [cc, vv] = r[i++]; if (!(cc in val)) val[cc] = vv; else (val['_' + cc] = val['_' + cc] || []).push(vv); }
				if (type === 1) { loop.push({ x: val[10], y: val[20] }, { x: val[11], y: val[21] }); }
				else if (type === 2) {
					arcPoints(val[10], val[20], val[40], val[50] * D2R, val[51] * D2R, (x, y) => loop.push({ x, y }), val[73] === 0);
				} else if (type === 3) {
					ellipsePoints({ x: val[10], y: val[20] }, { x: val[11], y: val[21] }, val[40], val[50] * D2R, val[51] * D2R, (x, y) => loop.push({ x, y }), val[73] === 0);
				} else if (type === 4) {
					// сплайн-ребро: берём контрольные точки (для заливки достаточно)
					const xs = [val[10], ...(val._10 || [])], ys = [val[20], ...(val._20 || [])];
					for (let q = 0; q < xs.length; q++) if (xs[q] != null) loop.push({ x: xs[q], y: ys[q] });
				}
			}
		}
		if (loop.length > 2) loops.push(loop);
	}
	return loops.length ? { ...o, loops, solid } : null;
}

// ---- DWG (LibreDWG) ----
function normDwg(e) {
	const P = (p) => pt(p);
	switch (e.type) {
		case 'LINE': return { ...common(e, 'LINE'), a: P(e.startPoint), b: P(e.endPoint), flip: false };
		case 'CIRCLE': return { ...common(e, 'CIRCLE'), c: P(e.center), r: e.radius };
		case 'ARC': return { ...common(e, 'ARC'), c: P(e.center), r: e.radius, a0: e.startAngle, a1: e.endAngle };
		case 'ELLIPSE': return { ...common(e, 'ELLIPSE'), c: P(e.center), m: P(e.majorAxisEndPoint), ratio: e.axisRatio, a0: e.startAngle || 0, a1: e.endAngle == null ? Math.PI * 2 : e.endAngle, flip: false };
		case 'LWPOLYLINE':
			return { ...common(e, 'POLY'), pts: (e.vertices || []).map((v) => ({ x: v.x, y: v.y, b: v.bulge || 0 })), closed: !!((e.flag || 0) & 513) };
		case 'POLYLINE2D': case 'POLYLINE3D': case 'POLYLINE':
			return { ...common(e, 'POLY'), pts: (e.vertices || []).filter((v) => !((v.flag || 0) & 16)).map((v) => ({ x: v.x, y: v.y, b: v.bulge || 0 })), closed: !!((e.flag || 0) & 1), flip: e.type === 'POLYLINE3D' ? false : common(e).flip };
		case 'SPLINE':
			return { ...common(e, 'SPLINE'), deg: e.degree || 3, ctrl: (e.controlPoints || []).map(P), knots: e.knots || [], w: e.weights && e.weights.length ? e.weights : null, fit: (e.fitPoints || []).map(P), closed: !!((e.flag || 0) & 1), flip: false };
		case 'TEXT': case 'ATTRIB': {
			// у ATTRIB параметры надписи лежат во вложенном объекте text
			const t = e.type === 'ATTRIB' ? e.text || {} : e;
			if (e.type === 'ATTRIB' && (e.flags & 1)) return null; // невидимый атрибут
			const s = e.type === 'ATTRIB' ? t.text : e.text;
			const p2 = t.endPoint && (t.halign || t.valign) ? P(t.endPoint) : null;
			return { ...common(e, 'TEXT'), p: P(t.startPoint), p2, h: t.textHeight || 1, rot: t.rotation || 0, s: s || '', ha: t.halign || 0, va: t.valign || 0, wf: t.xScale || 1 };
		}
		case 'MTEXT': {
			const dv = e.direction;
			const rot = dv && (dv.x || dv.y) ? Math.atan2(dv.y, dv.x) : e.rotation || 0;
			return { ...common(e, 'MTEXT'), p: P(e.insertionPoint), h: e.textHeight || 1, rot, s: e.text || '', attach: e.attachmentPoint || 1, flip: false };
		}
		case 'INSERT': {
			const ins = { ...common(e, 'INSERT'), name: String(e.name || '').toUpperCase(), p: P(e.insertionPoint), sx: e.xScale == null ? 1 : e.xScale, sy: e.yScale == null ? 1 : e.yScale, rot: e.rotation || 0, cols: e.columnCount || 1, rows: e.rowCount || 1, dc: e.columnSpacing || 0, dr: e.rowSpacing || 0 };
			ins.attribs = normList(e.attribs || [], normDwg);
			return ins;
		}
		case 'DIMENSION': return e.name ? { ...common(e, 'INSERT'), name: String(e.name).toUpperCase(), p: { x: 0, y: 0 }, sx: 1, sy: 1, rot: 0, cols: 1, rows: 1, dc: 0, dr: 0, dim: true, flip: false } : null;
		case 'SOLID': case 'TRACE': return { ...common(e, 'FILL'), pts: solidPts([e.corner1, e.corner2, e.corner3, e.corner4].filter(Boolean).map(P)) };
		case '3DFACE': return { ...common(e, 'POLY'), pts: [e.corner1, e.corner2, e.corner3, e.corner4].filter(Boolean).map((v) => ({ x: v.x, y: v.y, b: 0 })), closed: true, flip: false };
		case 'HATCH': {
			const loops = [];
			for (const bp of e.boundaryPaths || []) {
				const loop = [];
				if (bp.vertices) polyPoints(bp.vertices.map((v) => ({ x: v.x, y: v.y, b: v.bulge || 0 })), bp.isClosed !== false, (x, y) => loop.push({ x, y }));
				else for (const ed of bp.edges || []) {
					if (ed.type === 1) loop.push(pt(ed.start), pt(ed.end));
					else if (ed.type === 2) {
						arcPoints(ed.center.x, ed.center.y, ed.radius, ed.startAngle, ed.endAngle, (x, y) => loop.push({ x, y }), ed.isCCW === false);
					} else if (ed.type === 3) {
						ellipsePoints(pt(ed.center), pt(ed.end), ed.lengthOfMinorAxis, ed.startAngle, ed.endAngle, (x, y) => loop.push({ x, y }), ed.isCCW === false);
					} else if (ed.type === 4) {
						const pts = ed.controlPoints && ed.controlPoints.length ? ed.controlPoints : ed.fitDatum || [];
						for (const q of pts) loop.push(pt(q));
					}
				}
				if (loop.length > 2) loops.push(loop);
			}
			return loops.length ? { ...common(e, 'HATCH'), loops, solid: e.solidFill === 1 } : null;
		}
	}
	return null;
}

// =====================================================================
// Геометрия
// =====================================================================
function arcSegs(r, sweep) { return Math.max(4, Math.min(720, Math.ceil(Math.abs(sweep) / (Math.PI * 2) * 96))); }
// дуга от a0 до a1 против часовой; cw — ребро штриховки «по часовой»: углы зеркальны (от −a0 по часовой)
function arcPoints(cx, cy, r, a0, a1, emit, cw = false) {
	let sweep = a1 - a0;
	while (sweep <= 1e-12) sweep += Math.PI * 2;
	if (cw) { a0 = -a0; sweep = -sweep; }
	const n = arcSegs(r, sweep);
	for (let k = 0; k <= n; k++) { const a = a0 + sweep * k / n; emit(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
	return sweep;
}
function ellipsePoints(c, m, ratio, t0, t1, emit, cw = false) {
	let sweep = t1 - t0;
	while (sweep <= 1e-12) sweep += Math.PI * 2;
	if (sweep > Math.PI * 2 + 1e-9) sweep = Math.PI * 2;
	if (cw) { t0 = -t0; sweep = -sweep; }
	const nx = -m.y * ratio, ny = m.x * ratio;
	const n = arcSegs(1, sweep);
	for (let k = 0; k <= n; k++) {
		const t = t0 + sweep * k / n, ct = Math.cos(t), st = Math.sin(t);
		emit(c.x + m.x * ct + nx * st, c.y + m.y * ct + ny * st);
	}
}
// полилиния с выпуклостями (bulge) -> точки; segCb(i, x1,y1,x2,y2, bulge) — для описания сегментов
function polyPoints(pts, closed, emit, segCb) {
	const n = pts.length;
	if (!n) return;
	const last = closed ? n : n - 1;
	emit(pts[0].x, pts[0].y);
	for (let i = 0; i < last; i++) {
		const p = pts[i], q = pts[(i + 1) % n];
		const b = p.b || 0;
		if (segCb) segCb(i, p, q, b);
		if (Math.abs(b) < 1e-9) { emit(q.x, q.y); continue; }
		const dx = q.x - p.x, dy = q.y - p.y, c = Math.hypot(dx, dy);
		if (c < 1e-12) continue;
		const k = (1 - b * b) / (4 * b);
		const cx = (p.x + q.x) / 2 - dy * k, cy = (p.y + q.y) / 2 + dx * k;
		const r = Math.hypot(p.x - cx, p.y - cy);
		const a0 = Math.atan2(p.y - cy, p.x - cx), sweep = 4 * Math.atan(b);
		const m = arcSegs(r, sweep);
		for (let j = 1; j <= m; j++) { const a = a0 + sweep * j / m; emit(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
	}
}
function bulgeArc(p, q, b) {
	const dx = q.x - p.x, dy = q.y - p.y;
	const k = (1 - b * b) / (4 * b);
	const cx = (p.x + q.x) / 2 - dy * k, cy = (p.y + q.y) / 2 + dx * k;
	return { cx, cy, r: Math.hypot(p.x - cx, p.y - cy), sweep: 4 * Math.atan(b) };
}
// B-сплайн (NURBS) по контрольным точкам; если их нет — сглаживание по точкам аппроксимации
function splinePoints(e, emit) {
	const P = e.ctrl, deg = e.deg, U = e.knots;
	if (P.length > deg && U.length === P.length + deg + 1) {
		const W = e.w && e.w.length === P.length ? e.w : null;
		const u0 = U[deg], u1 = U[P.length];
		const n = Math.min(4000, Math.max(16, P.length * 12));
		for (let k = 0; k <= n; k++) {
			const u = u0 + (u1 - u0) * k / n;
			let s = deg;
			while (s < P.length - 1 && u >= U[s + 1]) s++;
			// де Бур
			const d = [];
			for (let j = 0; j <= deg; j++) {
				const q = P[s - deg + j], w = W ? W[s - deg + j] : 1;
				d.push([q.x * w, q.y * w, w]);
			}
			for (let r = 1; r <= deg; r++) for (let j = deg; j >= r; j--) {
				const i = s - deg + j;
				const den = U[i + deg - r + 1] - U[i];
				const a = den > 1e-14 ? (u - U[i]) / den : 0;
				for (let c = 0; c < 3; c++) d[j][c] = (1 - a) * d[j - 1][c] + a * d[j][c];
			}
			const v = d[deg];
			emit(v[0] / v[2], v[1] / v[2]);
		}
		return;
	}
	const F = e.fit.length > 1 ? e.fit : P;
	if (F.length < 2) return;
	if (F.length === 2) { emit(F[0].x, F[0].y); emit(F[1].x, F[1].y); return; }
	const curve = new THREE.CatmullRomCurve3(F.map((q) => new THREE.Vector3(q.x, q.y, 0)), e.closed, 'centripetal');
	for (const v of curve.getPoints(Math.min(4000, F.length * 16))) emit(v.x, v.y);
}

// ---- аффинные преобразования 2D: [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f ----
const IDENT = [1, 0, 0, 1, 0, 0];
function mul(m, n) {
	return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
		m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}
function trs(x, y, rot, sx, sy) { const c = Math.cos(rot), s = Math.sin(rot); return [c * sx, s * sx, -s * sy, c * sy, x, y]; }
const FLIP = [-1, 0, 0, 1, 0, 0]; // объект с нормалью вниз (0,0,-1): X системы объекта смотрит влево
function similarity(m) {
	const sx = Math.hypot(m[0], m[1]), sy = Math.hypot(m[2], m[3]);
	return Math.abs(sx - sy) < 1e-6 * Math.max(sx, 1) && Math.abs(m[0] * m[2] + m[1] * m[3]) < 1e-6 * Math.max(sx * sy, 1) ? sx : 0;
}

// =====================================================================
// Текст
// =====================================================================
function cleanText(s, mtext) {
	s = String(s || '');
	s = s.replace(/\\U\+([0-9a-fA-F]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
	s = s.replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%[uUoOkK]/g, '').replace(/%%%/g, '%')
		.replace(/%%(\d{3})/g, (m, d) => String.fromCharCode(+d));
	if (!mtext) return s;
	return s.replace(/\\P/g, '\n').replace(/\\X/g, '\n')
		.replace(/\\[FfHhWwQqTtAaCcp][^;\\]*;/g, '')
		.replace(/\\S([^;]*);/g, (m, a) => a.replace(/[\^#]/, '/'))
		.replace(/\\[LlOoKkNn]/g, '').replace(/\\~/g, ' ')
		.replace(/\\\\/g, '\u0001').replace(/\\([{}])/g, '$1').replace(/[{}]/g, '').replace(/\u0001/g, '\\');
}

const FONT = 'Arial, "Segoe UI", sans-serif';
const CAP = 0.716;      // высота прописной буквы в долях кегля (Arial)
const LINE_STEP = 1.19; // шаг строк MTEXT в кеглях (≈ 5/3 высоты текста)
let measureCtx = null;
function textMesh(lines, colorHex, opt) {
	// opt: { h, wf, ha: 0|1|2, vRef: 'base'|'bottom'|'middle'|'top'|'mtop'|'mmid'|'mbot', fitW }
	if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
	let px = 48;
	measureCtx.font = `${px}px ${FONT}`;
	let widths = lines.map((l) => measureCtx.measureText(l).width / px);
	const wEm = Math.max(0.01, ...widths);
	if (wEm * px > 4000) { px = Math.max(8, Math.floor(4000 / wEm)); }
	const top = -0.95, bot = (lines.length - 1) * LINE_STEP + 0.3;
	const cw = Math.ceil(wEm * px) + 4, ch = Math.ceil((bot - top) * px);
	const cv = document.createElement('canvas');
	cv.width = cw; cv.height = ch;
	const ctx = cv.getContext('2d');
	ctx.font = `${px}px ${FONT}`;
	ctx.fillStyle = colorHex;
	ctx.textBaseline = 'alphabetic';
	lines.forEach((l, i) => {
		const lw = widths[i];
		const x = opt.ha === 1 ? (wEm - lw) / 2 : opt.ha === 2 ? wEm - lw : 0;
		ctx.fillText(l, 2 + x * px, (-top + i * LINE_STEP) * px);
	});
	const tex = new THREE.CanvasTexture(cv);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.anisotropy = 4;
	const em = opt.h / CAP;
	let wf = opt.wf || 1;
	if (opt.fitW) wf = opt.fitW / (wEm * em);
	const ax = opt.ha === 1 ? wEm / 2 : opt.ha === 2 ? wEm : 0;
	const lastBase = (lines.length - 1) * LINE_STEP;
	const ay = ({ base: 0, bottom: 0.21, middle: -CAP / 2, top: -CAP, mtop: -CAP, mmid: (lastBase - CAP) / 2, mbot: lastBase })[opt.vRef] || 0;
	const x0 = (-2 / px - ax) * em * wf, x1 = (cw / px - 2 / px - ax) * em * wf;
	const y0 = -(top - ay) * em, y1 = -(bot - ay) * em;
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute([x0, y1, 0, x1, y1, 0, x1, y0, 0, x0, y0, 0], 3));
	g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
	g.setIndex([0, 1, 2, 0, 2, 3]);
	const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, transparent: true, depthWrite: false, side: THREE.DoubleSide });
	const mesh = new THREE.Mesh(g, mat);
	mesh.userData.dxfText = true;
	mesh.raycast = () => { };
	return mesh;
}

// =====================================================================
// Построение объекта three.js
// =====================================================================
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
// opts.fg — цвет «белого/чёрного» (ACI 7) на текущем фоне; opts.texts — рисовать ли надписи
export function buildDrawing(doc, opts = {}) {
	const fg = opts.fg == null ? 0xe6ebf2 : opts.fg;
	const withTexts = opts.texts !== false;
	const S = doc.scale || 1;
	const root = new THREE.Group();
	root.name = 'Чертёж';
	root.userData.drawing = true;
	const buckets = new Map();   // слой|цвет -> { pos, meta }
	const fills = new Map();     // слой|цвет|прозрачность -> { pos }
	const texts = [];            // { layer, mesh }
	const stats = { entities: 0, texts: 0, skippedTexts: 0, blocks: 0 };
	const layerOf = (name) => doc.layers[name] || null;

	function resolveColor(e, layer, inh) {
		let aci = e.aci;
		if (aci === 0) return inh.color;                          // ПОБЛОКУ
		if (aci == null || aci === 256 || aci < 0) {               // ПОСЛОЮ
			const L = layerOf(layer);
			aci = L && L.aci != null ? Math.abs(L.aci) : 7;
			if (aci === 0 || aci === 256) aci = 7;
		}
		const c = ACI[aci] == null ? fg : ACI[aci];
		return aci === 7 || c === 0xffffff || c === 0 ? fg : c;
	}
	function bucket(layer, color) {
		const k = layer + '\u0000' + color;
		let b = buckets.get(k);
		if (!b) { b = { layer, color, pos: [], meta: [] }; buckets.set(k, b); }
		return b;
	}
	// линия по точкам в координатах объекта, m — в мировые
	function stroke(b, m, meta) {
		let px = null, py = null;
		return (x, y) => {
			const X = (m[0] * x + m[2] * y + m[4]) * S, Y = (m[1] * x + m[3] * y + m[5]) * S;
			if (px !== null && (X !== px || Y !== py)) { b.pos.push(px, py, 0, X, Y, 0); b.meta.push(typeof meta === 'function' ? meta() : meta); }
			px = X; py = Y;
		};
	}
	const tp = (m, p) => ({ x: (m[0] * p.x + m[2] * p.y + m[4]) * S, y: (m[1] * p.x + m[3] * p.y + m[5]) * S });

	function draw(list, m, inh, depth) {
		for (const e0 of list) {
			if (e0.hidden) continue;
			const layer = e0.layer === '0' && inh.layer ? inh.layer : e0.layer;
			const L = layerOf(layer);
			if (L && !L.visible && !opts.allLayers) continue;
			const color = resolveColor(e0, layer, inh);
			const em = e0.flip ? mul(m, FLIP) : m;
			stats.entities++;
			switch (e0.t) {
				case 'LINE': {
					const b = bucket(layer, color);
					const meta = { k: 'line', a: tp(m, e0.a), b: tp(m, e0.b) };
					const s = stroke(b, m, meta); s(e0.a.x, e0.a.y); s(e0.b.x, e0.b.y);
					break;
				}
				case 'CIRCLE': case 'ARC': {
					const b = bucket(layer, color);
					const k = similarity(em);
					const full = e0.t === 'CIRCLE';
					const a0 = full ? 0 : e0.a0, a1 = full ? Math.PI * 2 : e0.a1;
					let sw = a1 - a0; while (sw <= 1e-12) sw += Math.PI * 2;
					const meta = k ? { k: 'arc', c: tp(em, e0.c), r: e0.r * k * S, full, sweep: sw } : { k: 'curve' };
					arcPoints(e0.c.x, e0.c.y, e0.r, a0, a1, stroke(b, em, meta));
					break;
				}
				case 'ELLIPSE': {
					const b = bucket(layer, color);
					ellipsePoints(e0.c, e0.m, e0.ratio, e0.a0, e0.a1, stroke(b, em, { k: 'curve' }));
					break;
				}
				case 'POLY': {
					if (e0.pts.length < 2) break;
					const b = bucket(layer, color);
					const k = similarity(em);
					let cur = { k: 'curve' };
					const s = stroke(b, em, () => cur);
					polyPoints(e0.pts, e0.closed, s, (i, p, q, bl) => {
						if (Math.abs(bl) < 1e-9) cur = { k: 'line', a: tp(em, p), b: tp(em, q) };
						else if (k) { const a = bulgeArc(p, q, bl); cur = { k: 'arc', c: tp(em, { x: a.cx, y: a.cy }), r: a.r * k * S, full: false, sweep: Math.abs(a.sweep) }; }
						else cur = { k: 'curve' };
					});
					break;
				}
				case 'SPLINE': splinePoints(e0, stroke(bucket(layer, color), em, { k: 'curve' })); break;
				case 'FILL': case 'HATCH': {
					const solid = e0.t === 'FILL' || e0.solid;
					const key = layer + '\u0000' + color + '\u0000' + (solid ? 1 : 0);
					let f = fills.get(key);
					if (!f) { f = { layer, color, solid, pos: [] }; fills.set(key, f); }
					const loops = e0.t === 'FILL' ? [e0.pts] : e0.loops;
					addFill(f, loops.map((lp) => lp.map((q) => tp(em, q))));
					break;
				}
				case 'TEXT': case 'MTEXT': {
					if (!withTexts) break;
					if (stats.texts >= MAX_TEXTS) { stats.skippedTexts++; break; }
					const str = cleanText(e0.s, e0.t === 'MTEXT');
					if (!str.trim()) break;
					let lines, opt, anchor = e0.p, rot = e0.rot;
					if (e0.t === 'MTEXT') {
						lines = str.split('\n');
						const a = (e0.attach || 1) - 1;
						opt = { h: e0.h, ha: a % 3, vRef: ['mtop', 'mmid', 'mbot'][Math.floor(a / 3)] || 'mtop' };
					} else {
						lines = [str.replace(/\n/g, ' ')];
						const ha = e0.ha | 0, va = e0.va | 0;
						opt = { h: e0.h, wf: e0.wf, ha: 0, vRef: 'base' };
						if ((ha || va) && e0.p2) {
							if (ha === 3 || ha === 5) {
								rot = Math.atan2(e0.p2.y - e0.p.y, e0.p2.x - e0.p.x);
								opt.fitW = Math.hypot(e0.p2.x - e0.p.x, e0.p2.y - e0.p.y) || undefined;
							} else {
								anchor = e0.p2;
								opt.ha = ha === 4 ? 1 : Math.min(ha, 2);
								opt.vRef = ha === 4 ? 'middle' : ['base', 'bottom', 'middle', 'top'][va] || 'base';
							}
						}
					}
					const mesh = textMesh(lines, hex(color), opt);
					const lm = mul(em, trs(anchor.x, anchor.y, rot, 1, 1));
					mesh.matrixAutoUpdate = false;
					mesh.matrix.set(lm[0] * S, lm[2] * S, 0, lm[4] * S, lm[1] * S, lm[3] * S, 0, lm[5] * S, 0, 0, 1, 0.001, 0, 0, 0, 1);
					texts.push({ layer, mesh });
					stats.texts++;
					break;
				}
				case 'INSERT': {
					if (depth >= MAX_DEPTH) break;
					const blk = doc.blocks[e0.name];
					if (blk) {
						stats.blocks++;
						const cols = Math.max(1, Math.min(e0.cols | 0 || 1, 200)), rows = Math.max(1, Math.min(e0.rows | 0 || 1, 200));
						const nextInh = { color, layer };
						for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
							// массив вставок: смещение по осям, повёрнутым вместе с блоком
							const off = trs(0, 0, e0.rot, 1, 1);
							const ox = e0.p.x + off[0] * c * e0.dc + off[2] * r * e0.dr, oy = e0.p.y + off[1] * c * e0.dc + off[3] * r * e0.dr;
							const bm = mul(em, mul(trs(ox, oy, e0.rot, e0.sx, e0.sy), [1, 0, 0, 1, -blk.base.x, -blk.base.y]));
							draw(blk.ents, bm, nextInh, depth + 1);
						}
					}
					// атрибуты DWG уже в мировых координатах
					if (e0.attribs && e0.attribs.length) draw(e0.attribs, m, { color, layer }, depth + 1);
					break;
				}
			}
		}
	}

	function addFill(f, loops) {
		loops = loops.filter((lp) => lp.length >= 3);
		if (!loops.length) return;
		// самый большой контур — внешний, остальные — отверстия
		const area = (lp) => { let a = 0; for (let i = 0; i < lp.length; i++) { const p = lp[i], q = lp[(i + 1) % lp.length]; a += p.x * q.y - q.x * p.y; } return a / 2; };
		loops.sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
		const outer = loops[0].map((p) => new THREE.Vector2(p.x, p.y));
		const holes = loops.slice(1).map((lp) => lp.map((p) => new THREE.Vector2(p.x, p.y)));
		let tris;
		try { tris = THREE.ShapeUtils.triangulateShape(outer, holes); } catch { return; }
		const all = [outer, ...holes].flat();
		for (const t of tris) for (const i of t) f.pos.push(all[i].x, all[i].y, -0.001);
	}

	draw(doc.ents, IDENT, { color: fg, layer: null }, 0);

	// ---- собрать по слоям ----
	const layerGroups = new Map();
	const groupFor = (name) => {
		let g = layerGroups.get(name);
		if (!g) { g = new THREE.Group(); g.name = name || '0'; g.userData.dxfLayer = true; layerGroups.set(name, g); }
		return g;
	};
	for (const b of buckets.values()) {
		if (!b.pos.length) continue;
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
		const mat = new THREE.LineBasicMaterial({ color: b.color, toneMapped: false });
		mat.userData.baseColor = mat.color.clone();
		const ls = new THREE.LineSegments(g, mat);
		ls.name = 'Линии ' + hex(b.color);
		ls.userData.dxfLine = true;
		ls.userData.segMeta = b.meta;
		ls.userData.color = new THREE.Color(b.color);
		groupFor(b.layer).add(ls);
	}
	for (const f of fills.values()) {
		if (!f.pos.length) continue;
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', new THREE.Float32BufferAttribute(f.pos, 3));
		const mat = new THREE.MeshBasicMaterial({ color: f.color, toneMapped: false, side: THREE.DoubleSide, transparent: !f.solid, opacity: f.solid ? 1 : 0.22, depthWrite: false });
		const m = new THREE.Mesh(g, mat);
		m.name = f.solid ? 'Заливка' : 'Штриховка';
		m.userData.dxfFill = true;
		m.raycast = () => { };
		m.renderOrder = -1;
		groupFor(f.layer).add(m);
	}
	for (const t of texts) groupFor(t.layer).add(t.mesh);
	const names = [...layerGroups.keys()].sort((a, b) => String(a).localeCompare(String(b), 'ru', { numeric: true }));
	for (const n of names) root.add(layerGroups.get(n));
	stats.layers = layerGroups.size;
	root.userData.stats2d = stats;
	return root;
}

// для эскизов и подписи «Формат»
export function drawingFormatName(doc) {
	if (doc.format === 'DWG') return 'DWG (AutoCAD ' + (doc.versionName || doc.version) + ')';
	const v = ({ AC1009: 'R12', AC1012: 'R13', AC1014: 'R14', AC1015: '2000', AC1018: '2004', AC1021: '2007', AC1024: '2010', AC1027: '2013', AC1032: '2018' })[doc.version];
	return 'DXF' + (v ? ' (AutoCAD ' + v + ')' : '');
}
