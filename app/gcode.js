// Черновые управляющие программы по результатам анализа детали (Fanuc).
//   PUMA 3050LM: для каждого установа — подрезка торца, сверление/расточка по оси,
//   наружный контур циклом G71 (или G73 при поднутрениях) и чистовой G70.
//   KVL 1000: для каждого установа — торцевание и сверление отверстий по координатам.
// Контур и карманы фрезерной детали — в CAM: по модели их надёжно не построить.
// Программа — ЧЕРНОВИК: перед запуском проверить на симуляторе и в режиме «пробный ход».
import { cutMode, materialGroup, hasUndercut, LATHE_TOOLS, MACHINES } from './techproc.js';

const n3 = (v) => {
	const r = Math.round(v * 1000) / 1000;
	return (Object.is(r, -0) ? 0 : r).toFixed(3).replace(/0+$/, '');
};
const TR = { а: 'A', б: 'B', в: 'V', г: 'G', д: 'D', е: 'E', ё: 'E', ж: 'ZH', з: 'Z', и: 'I', й: 'Y', к: 'K', л: 'L', м: 'M', н: 'N', о: 'O', п: 'P', р: 'R', с: 'S', т: 'T', у: 'U', ф: 'F', х: 'H', ц: 'C', ч: 'CH', ш: 'SH', щ: 'SCH', ъ: '', ы: 'Y', ь: '', э: 'E', ю: 'YU', я: 'YA' };
// комментарии — латиницей заглавными: стойка может не читать кириллицу; скобки внутри комментария недопустимы
export const translit = (s) => String(s).toLowerCase().split('').map((ch) => (TR[ch] ?? ch)).join('').toUpperCase().replace(/[()]/g, ' ').replace(/Ø/g, 'D').replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();

class Prog {
	constructor() { this.lines = []; this.n = 0; }
	c(txt) { this.lines.push(`(${translit(txt)})`); }
	b(txt) { this.n += 10; this.lines.push(`N${this.n} ${txt}`); }
	raw(txt) { this.lines.push(txt); }
	toString() { return this.lines.join('\n'); }
}

// ---------------------------------------------------------------------------
// Токарный: PUMA 3050LM
// ---------------------------------------------------------------------------
function contourBlocks(prof, pts, zOf, first) {
	// точки контура от свободного торца (Z0) к патрону; X — диаметр. Порядок — по номеру точки
	// профиля, а не по Z: у уступа две точки с одинаковым Z
	const inc = zOf(1) > zOf(0);
	const seq = [...pts].sort((a, b) => (inc ? b.i - a.i : a.i - b.i));
	const out = [];
	for (let k = 0; k < seq.length; k++) {
		const q = seq[k];
		const x = n3(q.r * 2), z = n3(zOf(q.t));
		if (k === 0) { out.push(`G01 X${x} Z${z}${first ? ' ' + first : ''}`); continue; }
		const prev = seq[k - 1];
		// участок между соседними точками профиля
		const sg = prof.segs.find((s) => (s.from === prev.i && s.to === q.i) || (s.from === q.i && s.to === prev.i));
		if (sg && sg.el.kind === 'arc') {
			const e = sg.el;
			const zc = zOf(e.tc), xc = e.rc;
			const z0 = zOf(prev.t), x0 = prev.r, z1 = zOf(q.t), x1 = q.r;
			// в плоскости Z (вправо) – X (вверх): против часовой — G03
			const cr = (z0 - zc) * (x1 - xc) - (x0 - xc) * (z1 - zc);
			out.push(`${cr > 0 ? 'G03' : 'G02'} X${x} Z${z} R${n3(e.R)}`);
		} else out.push(`G01 X${x} Z${z}`);
	}
	return { blocks: out, seq };
}

function pumaSetup(P, part, blank, S, mat, prog, name, matText) {
	const pl = part.plan, pr = part.profile;
	const maxS = MACHINES.lathe.rpm;
	const zOf = S === 'A' ? pl.zA : pl.zB;
	const outer = S === 'A' ? pl.outerA : pl.outerB;
	const inner = S === 'A' ? pl.innerA : pl.innerB;
	const end = pl.sideEnd(S);
	const Db = blank.D;
	const stock = S === 'A' ? pl.face : pl.face + (blank.grip || 0);
	const xs = Db + 4;
	const rough = cutMode(mat, 'turnR', Db, maxS), fin = cutMode(mat, 'turnF', Db, maxS), bore = cutMode(mat, 'bore', 30, maxS);
	const tail = S === 'A' ? pl.tailA : pl.tailB;

	P.raw('%');
	P.raw(`O${prog} (${translit(name)} USTANOV ${S === 'A' ? 'A' : 'B'})`);
	P.c(`Material: ${matText}  zagotovka D${Db} L${blank.L}`);
	P.c(`${LATHE_TOOLS.rough.t} ${LATHE_TOOLS.rough.name} chern.`);
	P.c(`${LATHE_TOOLS.finish.t} ${LATHE_TOOLS.finish.name} chist.`);
	P.c(`Null detali: Z0 - svobodnyy torec ${end === 'right' ? 'pravyy' : 'levyy'} posle podrezki, X - os`);
	P.c(S === 'A' ? `Zazhim za zagotovku D${Db}, vylet ${pl.stickA}` : `Zazhim za D${n3(pl.clamp ? pl.clamp.d : Db)} v myagkih kulachkah, vylet ${pl.stickB}`);
	P.b('G21 G40 G80 G97 G99');
	P.b('G28 U0.');
	P.b('G28 W0.');

	// --- торец ---
	P.c('--- Podrezka torca ---');
	P.b(LATHE_TOOLS.rough.t);
	P.b(`G50 S${maxS}`);
	P.b(`G96 S${rough.vc} M03`);
	P.b(`G00 X${n3(xs)} Z${n3(stock + 2)} M08`);
	// без контура торец доводится этим же резцом до Z0, иначе — чистовым перед G70
	const hasContour = pr && outer.length >= 2;
	const zEnd = hasContour ? 0.2 : 0;
	const steps = Math.max(1, Math.ceil((stock - zEnd) / 2));
	for (let i = 1; i <= steps; i++) {
		const z = stock - (stock - zEnd) * i / steps;
		P.b(`G94 X-1.6 Z${n3(z)} F${n3(rough.f)}`);
	}
	P.b('G00 X200. Z50. M09');
	P.b('M01');

	// --- центровка, задний центр, сверление ---
	const bores = part.bores.filter((b) => (S === 'A' ? b.opens === 'both' || b.opens === end : b.opens === end));
	const minBore = bores.length ? Math.min(...bores.map((b) => b.d)) : null;
	if (minBore || tail) {
		const c = cutMode(mat, 'center', 6, maxS);
		P.c(`--- ${LATHE_TOOLS.center.t} centrovka ---`);
		P.b(LATHE_TOOLS.center.t);
		P.b(`G97 S${c.s} M03`);
		P.b('G00 X0. Z3. M08');
		P.b('G01 Z-5. F0.05');
		P.b('G00 Z50. M09');
	}
	let drillD = null;
	const deepest = bores.length ? Math.max(...bores.map((b) => b.len)) : 0;
	if (minBore && (bores.some((b) => b.through) || deepest > Math.min(6, 0.25 * minBore))) {
		drillD = minBore <= 20 ? Math.max(1, Math.floor(minBore - (minBore > 6 ? 1 : 0.2))) : Math.min(30, Math.floor(minBore - 6));
		const depth = bores.some((b) => b.through) ? part.length + stock + 0.3 * drillD + 2 : Math.max(...bores.map((b) => b.len));
		const d = cutMode(mat, 'drill', drillD, maxS);
		P.c(`--- ${LATHE_TOOLS.drill.t} sverlo D${drillD} ---`);
		P.b(LATHE_TOOLS.drill.t);
		P.b(`G97 S${d.s} M03`);
		P.b('G00 X0. Z3. M08');
		P.b('G74 R1.');
		P.b(`G74 Z${n3(-depth)} Q${Math.round(Math.min(drillD, 10) * 1000)} F${n3(d.f)}`);
		P.b('G00 Z50. M09');
		P.b('M01');
	}
	if (tail) {
		P.c('Zadniy centr: podvesti babku knopkami, pinol vpered');
		P.b('M78');
		P.b('G04 X1.');
	}

	// --- наружный контур ---
	if (pr && outer.length >= 2) {
		const { blocks, seq } = contourBlocks(pr.outer, outer, zOf, `F${n3(fin.f)} S${fin.vc}`);
		const uc = hasUndercut(seq);
		const p = 8000 + (S === 'A' ? 0 : 500), q = p + 10 * (blocks.length + 1);
		const minX = Math.min(...seq.map((x) => x.r * 2));
		P.c(`--- Naruzhnyy kontur chernovoy ${uc ? 'G73' : 'G71'} ---`);
		if (uc) P.c('Est kanavki / podnutreniya: proverit, prohodit li plastina VBMT 35 grad, uzkie kanavki - kanavochnym rezcom');
		P.b(LATHE_TOOLS.rough.t);
		P.b(`G50 S${maxS}`);
		P.b(`G96 S${rough.vc} M03`);
		P.b(`G00 X${n3(xs)} Z2. M08`);
		if (uc) {
			const U = (Db - minX) / 2;
			P.b(`G73 U${n3(U)} W0. R${Math.max(2, Math.ceil(U / 1.5))}`);
			P.b(`G73 P${p} Q${q} U0.5 W0.1 F${n3(rough.f * 0.8)}`);
		} else {
			P.b('G71 U2. R0.5');
			P.b(`G71 P${p} Q${q} U0.5 W0.1 F${n3(rough.f)}`);
		}
		// блоки контура P…Q: подход по X к первой точке, контур, выход за заготовку
		const firstX = n3(seq[0].r * 2);
		P.raw(`N${p} G00 X${firstX}`);
		blocks.forEach((b, i) => P.raw(`N${p + 10 * (i + 1)} ${b}`));
		P.raw(`N${q} G01 X${n3(xs)}`);
		P.b('G00 X200. Z50. M09');
		P.b('M01');
		P.c('--- Naruzhnyy kontur chistovoy G70 ---');
		P.b(LATHE_TOOLS.finish.t);
		P.b(`G50 S${maxS}`);
		P.b(`G96 S${fin.vc} M03`);
		P.b(`G00 X${n3(seq[0].r * 2 + 2)} Z0. M08`);
		P.b(`G01 X${drillD ? n3(drillD - 1) : '-1.6'} F${n3(fin.f)} (TOREC NACHISTO)`);
		P.b('G00 Z2.');
		P.b(`G00 X${n3(xs)}`);
		P.b(`G70 P${p} Q${q}`);
		P.b('G00 X200. Z50. M09');
		P.b('M01');
	}

	// --- внутренний контур ---
	if (pr && inner.length >= 2 && drillD) {
		const { blocks, seq } = contourBlocks(pr.inner, inner, zOf, `F${n3(bore.f * 0.7)}`);
		const p = 9000 + (S === 'A' ? 0 : 500), q = p + 10 * (blocks.length + 1);
		const x0 = drillD - 1;
		P.c('--- Rastochka G71 / G70 ---');
		P.b(LATHE_TOOLS.bore.t);
		P.b(`G50 S${maxS}`);
		P.b(`G96 S${bore.vc} M03`);
		P.b(`G00 X${n3(x0)} Z2. M08`);
		P.b('G71 U1. R0.5');
		P.b(`G71 P${p} Q${q} U-0.3 W0.05 F${n3(bore.f)}`);
		P.raw(`N${p} G00 X${n3(seq[0].r * 2)}`);
		blocks.forEach((b, i) => P.raw(`N${p + 10 * (i + 1)} ${b}`));
		P.raw(`N${q} G01 X${n3(x0)}`);
		P.b(`G70 P${p} Q${q}`);
		P.b('G00 Z50. M09');
		P.b('M01');
	}
	if (tail) P.b('M79');
	if (S === 'A' && blank.fromBar) {
		const c = LATHE_TOOLS.cutoff;
		P.c(`--- ${c.t} otrezka, pripusk ${pl.face} na podrezku ---`);
		P.b(c.t);
		P.b(`G50 S2000`);
		P.b('G96 S80 M03');
		P.b(`G00 X${n3(xs)} Z${n3(zOf(pl.aEnd === 'right' ? 0 : part.length) - pl.face - 3)} M08`);
		P.b('G75 R0.5');
		P.b(`G75 X-1. P3000 F0.05`);
		P.b('G00 X200. Z50. M09');
	}
	P.c('Os C - otverstiya: sm. marshrutnuyu kartu, programmu sostavit v CAM / proverit M-kody osi C');
	P.b('G28 U0.');
	P.b('G28 W0.');
	P.b('M30');
	P.raw('%');
}

export function pumaPrograms(part, blank, o) {
	const mat = materialGroup(o.material);
	const name = o.name || 'DETAL';
	const P = new Prog();
	pumaSetup(P, part, blank, 'A', mat, o.progNo || 1001, name, o.material || '');
	P.raw('');
	const Q = new Prog();
	pumaSetup(Q, part, blank, 'B', mat, (o.progNo || 1001) + 1, name, o.material || '');
	return P.toString() + '\n' + Q.toString() + '\n';
}

// ---------------------------------------------------------------------------
// Фрезерный: KVL 1000 — торцевание и отверстия по установам
// ---------------------------------------------------------------------------
const DRILLS = [1, 1.5, 2, 2.5, 3, 3.3, 3.5, 4, 4.2, 4.5, 5, 5.5, 6, 6.5, 6.8, 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.2, 10.5, 11, 12, 13, 14, 15, 16];
const drillFor = (d) => [...DRILLS].reverse().find((x) => x <= d + 1e-6) || d;

function kvlSetup(P, part, blank, st, idx, mat, prog, name, matText) {
	const maxS = MACHINES.mill.rpm;
	const face = blank.w >= 60 ? 63 : 50;
	const holes = st.holes.filter((g) => g.d <= 16 && !(g.blind && g.len < g.d * 0.3));
	const big = st.holes.filter((g) => !holes.includes(g));
	const tools = [];
	if (idx < 2) tools.push({ kind: 'face', d: face, name: `Freza torc. D${face}` });
	if (holes.length) tools.push({ kind: 'center', d: 10, name: 'Centrovka D10 90 grad' });
	for (const d of [...new Set(holes.map((g) => drillFor(g.d)))].sort((a, b) => a - b)) tools.push({ kind: 'drill', d, name: `Sverlo D${d}` });
	tools.forEach((t, i) => { t.T = i + 1; });

	P.raw('%');
	P.raw(`O${prog} (${translit(name)} USTANOV ${translit(st.letter)} ${st.dir.replace('−', '-')})`);
	P.c(`Material: ${matText}`);
	tools.forEach((t) => P.c(`T${t.T} - ${t.name}`));
	P.c('Null detali G54: X0 Y0 - levyy nizhniy ugol vida so storony ustanova, Z0 - verh detali');
	P.b('G21 G17 G40 G49 G80 G90 G94');
	P.b('G91 G28 Z0.');
	P.b('G90');
	const change = (t, s) => {
		P.b(`T${t.T} M06`);
		P.b('G54 G00 X0. Y0.');
		P.b(`S${s} M03`);
		P.b(`G43 H${t.T} Z50. M08`);
	};
	const after = () => { P.b('G80'); P.b('G00 Z50. M09'); P.b('M05'); P.b('G91 G28 Z0.'); P.b('G90'); P.b('M01'); };
	// торцевание зигзагом: черновой проход Z0.5, чистовой Z0
	const ft = tools.find((t) => t.kind === 'face');
	if (ft) {
		const m = cutMode(mat, 'face', face, maxS);
		P.c(`--- T${ft.T} torcevanie ---`);
		change(ft, m.s);
		const step = face * 0.7, X0 = -face / 2 - 5, X1 = st.sizeX + face / 2 + 5;
		for (const z of [0.5, 0]) {
			let y = step / 2 - face * 0.15, dir = 1;
			P.b(`G00 X${n3(X0)} Y${n3(y)}`);
			P.b(`G01 Z${n3(z)} F${m.F}`);
			while (true) {
				P.b(`G01 X${n3(dir > 0 ? X1 : X0)}`);
				if (y >= st.sizeY - step / 2 + face * 0.15) break;
				y = Math.min(y + step, st.sizeY - step / 2 + face * 0.15);
				P.b(`G01 Y${n3(y)}`);
				dir = -dir;
			}
			P.b('G00 Z5.');
		}
		after();
	}
	// центровка всех отверстий
	const ct = tools.find((t) => t.kind === 'center');
	if (ct) {
		const m = cutMode(mat, 'center', 10, maxS);
		P.c(`--- T${ct.T} centrovka ---`);
		change(ct, m.s);
		let first = true;
		// R — 2 мм над началом отверстия (дно кармана или верх детали); G98 — отвод на Z5 над деталью
		P.b('G00 Z5.');
		for (const g of holes) for (const [x, y, z0 = 0] of g.pts) {
			const cz = z0 - Math.min(5, drillFor(g.d) / 2 + 0.5);
			P.b(first ? `G98 G81 X${n3(x)} Y${n3(y)} Z${n3(cz)} R${n3(z0 + 2)} F${m.F}` : `X${n3(x)} Y${n3(y)} Z${n3(cz)} R${n3(z0 + 2)}`);
			first = false;
		}
		after();
	}
	// сверление по диаметрам: глубина > 3D — G83 с выводом
	for (const t of tools.filter((x) => x.kind === 'drill')) {
		const m = cutMode(mat, 'drill', t.d, maxS);
		P.c(`--- T${t.T} sverlo D${t.d} ---`);
		change(t, m.s);
		let first = true;
		P.b('G00 Z5.');
		for (const g of holes.filter((h) => drillFor(h.d) === t.d)) {
			const depth = g.blind ? g.len : g.len + 0.3 * t.d + 1;
			const deep = depth > 3 * t.d;
			for (const [x, y, z0 = 0] of g.pts) {
				P.b(first
					? (deep ? `G98 G83 X${n3(x)} Y${n3(y)} Z${n3(z0 - depth)} R${n3(z0 + 2)} Q${n3(Math.max(1, t.d))} F${m.F}` : `G98 G81 X${n3(x)} Y${n3(y)} Z${n3(z0 - depth)} R${n3(z0 + 2)} F${m.F}`)
					: `X${n3(x)} Y${n3(y)} Z${n3(z0 - depth)} R${n3(z0 + 2)}`);
				first = false;
			}
			// следующая группа — с новым циклом (другая глубина / G81↔G83)
			first = true;
		}
		after();
	}
	for (const g of big) P.c(`D${n3(g.d)} ${g.blind ? 'gl. ' + n3(g.len) : 'skv.'} - frezerovat v CAM: ${g.pts.map(([x, y]) => `X${n3(x)} Y${n3(y)}`).join(' ')}`);
	if (st.floors.length) P.c(`Karmany / ustupy na glubinah ${st.floors.map((f) => n3(f.depth)).join(', ')} - v CAM`);
	P.b('G91 G28 Z0.');
	P.b('G28 Y0.');
	P.b('G90');
	P.b('M30');
	P.raw('%');
}

export function kvlPrograms(part, blank, o) {
	const mat = materialGroup(o.material);
	const name = o.name || 'DETAL';
	return part.setups.map((st, i) => {
		const P = new Prog();
		kvlSetup(P, part, blank, st, i, mat, (o.progNo || 2001) + i, name, o.material || '');
		return P.toString();
	}).join('\n\n') + '\n';
}
