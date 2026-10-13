"use strict";
/* Povolební analýza KV 2026 — statická stránka, data z data/*.json
   (generuje povolebni.py v projektu volebnidata). Interní část se načte
   z interni/, pokud existuje (lokálně); na GitHub Pages chybí. */

const BRNO = "582786";
const GREEN = "#0bd26f";
const GREY_ZELENI = "#9a9a9a";
// Sekvenční modrá (světlá → tmavá) a divergentní červená ↔ šedá ↔ modrá.
const SEQ = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];
const DIV_NEG = ["#a8302f", "#e34948", "#ef9a92", "#f6cfca"]; // od nejsilnějšího
const DIV_POS = ["#cde2fb", "#86b6ef", "#2a78d6", "#184f95"]; // od nejslabšího
const MID = { light: "#e4e3df", dark: "#4a4a46" };
const NODATA = { light: "#ffffff", dark: "#222222" };
const MIN_KOREL = 8;

const S = {
  index: null, barvy: null, strany: null, celky: {}, kand: {}, geo: null, geoById: null,
  interni: null, theme: "light", maps: [], route: null, korekce: false,
};

/* ------------------------------------------------------------------ util */

const $ = (sel, root = document) => root.querySelector(sel);
const NF1 = new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const NF2 = new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NF0 = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 0 });
const pct = (v, d = 1) => v == null || !isFinite(v) ? "–" : (d === 2 ? NF2 : NF1).format(v) + " %";
const pp = (v, d = 1) => v == null || !isFinite(v) ? "–" : (v > 0 ? "+" : v < 0 ? "−" : "±") + (d === 2 ? NF2 : NF1).format(Math.abs(v)) + " p. b.";
const int = v => v == null || !isFinite(v) ? "–" : NF0.format(Math.round(v));
const r2 = v => v == null ? "–" : (v > 0 ? "+" : v < 0 ? "−" : "") + NF2.format(Math.abs(v));
const sum = (arr, idx) => idx.reduce((a, i) => a + (arr[i] == null ? 0 : arr[i]), 0);
// Zvláštní okrsky (evidenční adresy na úřadě): volitelně počet voličů odhadnutý
// z vydaných obálek a průměrné účasti sousedních okrsků.
const vol = (ok, i) => S.korekce && ok.volici_odhad[i] != null ? ok.volici_odhad[i] : ok.volici[i];
const vol22 = (ok, i) => S.korekce && ok.volici22_odhad[i] != null ? ok.volici22_odhad[i] : ok.volici22[i];
const ucastAt = (ok, i) => ok.obalky[i] / vol(ok, i) * 100;
const ucast22At = (ok, i) => vol22(ok, i) ? ok.obalky22[i] / vol22(ok, i) * 100 : null;

function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "style") e.style.cssText = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "html") e.innerHTML = v; // jen pro náš vlastní statický markup
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) {
    if (k == null || k === false) continue;
    e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return e;
}

async function getJSON(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}
async function tryJSON(url) {
  try { return await getJSON(url); } catch (e) { return null; }
}

function dltClass(v) { return v == null ? "na" : v > 0.05 ? "up" : v < -0.05 ? "dn" : "na"; }

function wcorr(x, y, w) {
  let n = 0, sw = 0, mx = 0, my = 0;
  for (let i = 0; i < x.length; i++) {
    if (!isFinite(x[i]) || !isFinite(y[i]) || !(w[i] > 0)) continue;
    n++; sw += w[i]; mx += w[i] * x[i]; my += w[i] * y[i];
  }
  if (n < MIN_KOREL) return null;
  mx /= sw; my /= sw;
  let vx = 0, vy = 0, cv = 0;
  for (let i = 0; i < x.length; i++) {
    if (!isFinite(x[i]) || !isFinite(y[i]) || !(w[i] > 0)) continue;
    const dx = x[i] - mx, dy = y[i] - my;
    vx += w[i] * dx * dx; vy += w[i] * dy * dy; cv += w[i] * dx * dy;
  }
  return vx > 0 && vy > 0 ? cv / Math.sqrt(vx * vy) : null;
}

function korelSlovy(r) {
  if (r == null) return "nelze spočítat";
  if (r >= 0.5) return "silný překryv voličů";
  if (r >= 0.25) return "výrazný překryv";
  if (r >= 0.1) return "mírný překryv";
  if (r > -0.1) return "bez zřetelného vztahu";
  if (r > -0.25) return "mírně odlišný elektorát";
  if (r > -0.5) return "výrazně odlišný elektorát";
  return "zcela odlišný elektorát";
}

/* ------------------------------------------------------------- tooltip */

const tip = {
  show(ev, ...nodes) {
    const t = $("#tip");
    t.replaceChildren(...nodes);
    t.hidden = false;
    const x = ev.clientX ?? (ev.originalEvent && ev.originalEvent.clientX) ?? 0;
    const y = ev.clientY ?? (ev.originalEvent && ev.originalEvent.clientY) ?? 0;
    const w = t.offsetWidth, h = t.offsetHeight;
    t.style.left = Math.min(window.innerWidth - w - 8, x + 14) + "px";
    t.style.top = (y + h + 20 > window.innerHeight ? y - h - 12 : y + 14) + "px";
  },
  hide() { $("#tip").hidden = true; },
};

/* --------------------------------------------------------------- barvy */

function skupinaBarva(g) {
  const B = S.barvy, sk = B.skupiny[g] || B.skupiny[B.vychozi];
  return (S.theme === "dark" && sk.barva_tmava) || sk.barva;
}
function barvaStrany(s, ours) {
  if (ours) return GREEN;
  if (s.skupina === "zeleni") return GREY_ZELENI; // zelená patří jen naší kandidátce
  return skupinaBarva(s.skupina);
}
// S.strany = číselníky: cpp (politická příslušnost, PSTRANA), cns (navrhující strana, NSTRANA)
function stranaNazev(kod, cis = "cpp") {
  return (S.strany[cis] && S.strany[cis][String(kod)]) || String(kod);
}

/* ------------------------------------------------------------- pohled */

function makeView(route) {
  const z = S.celky[route.kod];
  const ok = z.okrsky;
  let idx = ok.id.map((_, i) => i);
  if (route.mc) idx = idx.filter(i => ok.mc[i] === route.mc);
  const full = !route.mc;
  const T = {
    platne: sum(ok.platne, idx), volici: idx.reduce((a, i) => a + vol(ok, i), 0), obalky: sum(ok.obalky, idx),
    odevzdane: sum(ok.odevzdane, idx),
    platne22: sum(ok.platne22, idx), volici22: idx.reduce((a, i) => a + (vol22(ok, i) || 0), 0), obalky22: sum(ok.obalky22, idx),
  };
  T.ucast = T.obalky / T.volici * 100;
  T.ucast22 = T.volici22 ? T.obalky22 / T.volici22 * 100 : null;
  const strany = z.strany.map(s => {
    const h = sum(ok.hlasy[s.por], idx);
    const h22 = ok.hlasy22[s.por] ? sum(ok.hlasy22[s.por], idx) : null;
    const p = T.platne ? h / T.platne * 100 : 0;
    const p22 = h22 == null || !T.platne22 ? null : h22 / T.platne22 * 100;
    const ours = s.por === z.nase;
    return { ...s, h, p, p22, d: p22 == null ? null : p - p22, ours, color: barvaStrany(s, ours) };
  }).sort((a, b) => b.p - a.p || a.por - b.por);
  const nase = strany.find(s => s.ours);
  const mcNazev = route.mc ? (S.index.mc.find(m => m.kod === route.mc) || {}).nazev : null;
  let title, kicker;
  if (route.kind === "mag") { title = "Brno"; kicker = "Zastupitelstvo města Brna"; }
  else if (route.kind === "magmc") { title = mcNazev; kicker = "Volby do zastupitelstva města Brna — výsledky v městské části"; }
  else { title = z.zobrazit; kicker = `Zastupitelstvo městské části ${z.nazev}`; }
  return { route, z, ok, idx, full, T, strany, nase, title, kicker, mcNazev };
}

/* --------------------------------------------------------------- start */

async function init() {
  S.theme = document.documentElement.dataset.theme || "light";
  $("#themeBtn").addEventListener("click", () => {
    S.theme = S.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = S.theme;
    try { localStorage.setItem("pa-theme", S.theme); } catch (e) {}
    themeLabel();
    render();
  });
  themeLabel();
  try { S.korekce = localStorage.getItem("pa-korekce") === "1"; } catch (e) {}
  const kb = $("#korekceBtn");
  kb.checked = S.korekce;
  kb.addEventListener("change", () => {
    S.korekce = kb.checked;
    try { localStorage.setItem("pa-korekce", S.korekce ? "1" : "0"); } catch (e) {}
    render();
  });
  try {
    [S.index, S.barvy, S.strany] = await Promise.all([
      getJSON("data/index.json"), getJSON("barvy.json"), getJSON("data/ciselnik.json"),
    ]);
  } catch (e) {
    $("#app").replaceChildren(el("p", { class: "err" }, "Nepodařilo se načíst data: " + e.message));
    return;
  }
  const ii = await tryJSON("interni/index.json");
  if (ii) {
    S.interni = { index: ii, komentare: (await tryJSON("interni/komentare.json")) || {}, celky: {} };
    $("#interniBadge").hidden = false;
  }
  const navMag = $("#navMag"), navMc = $("#navMc");
  for (const m of S.index.mc) navMag.append(el("option", { value: m.kod }, m.nazev));
  for (const c of S.index.celky.filter(c => c.typ === "mc").sort((a, b) => a.zobrazit.localeCompare(b.zobrazit, "cs")))
    navMc.append(el("option", { value: c.kod }, c.zobrazit));
  navMag.addEventListener("change", () => { if (navMag.value) location.hash = `#/mag/${navMag.value}`; });
  navMc.addEventListener("change", () => { if (navMc.value) location.hash = `#/mc/${navMc.value}`; });
  window.addEventListener("hashchange", () => render(true));
  render(true);
}

function themeLabel() { $("#themeBtn").textContent = S.theme === "dark" ? "světlý režim" : "tmavý režim"; }

function parseRoute() {
  const p = location.hash.replace(/^#\/?/, "").split("/");
  if (p[0] === "mag" && p[1]) return { kind: "magmc", kod: BRNO, mc: p[1], anchor: p[2] };
  if (p[0] === "mc" && p[1]) return { kind: "mc", kod: p[1], anchor: p[2] };
  return { kind: "mag", kod: BRNO };
}

async function ensureCelek(kod) {
  if (!S.celky[kod]) S.celky[kod] = await getJSON(`data/${kod}.json`);
  if (S.interni && !S.interni.celky[kod]) S.interni.celky[kod] = await tryJSON(`interni/${kod}.json`);
}
async function ensureGeo() {
  if (S.geo) return;
  S.geo = await getJSON("data/okrsky.geojson");
  S.geoById = new Map(S.geo.features.map(f => [f.properties.id, f]));
}

let renderToken = 0;
async function render(scrollTop) {
  const token = ++renderToken;
  const route = parseRoute();
  S.route = route;
  $("#navBrno").classList.toggle("on", route.kind === "mag");
  $("#navMag").value = route.kind === "magmc" ? route.mc : "";
  $("#navMc").value = route.kind === "mc" ? route.kod : "";
  $("#tabMag").classList.toggle("on", route.kind === "magmc");
  $("#tabMc").classList.toggle("on", route.kind === "mc");
  document.documentElement.style.setProperty("--toc-top", $(".top").offsetHeight + "px");
  try {
    await Promise.all([ensureCelek(route.kod), ensureGeo(), route.kind === "mc" ? ensureCelek(BRNO) : null]);
  } catch (e) {
    $("#app").replaceChildren(el("p", { class: "err" }, "Celek se nepodařilo načíst: " + e.message));
    return;
  }
  if (token !== renderToken) return;
  for (const m of S.maps) m.remove();
  S.maps = [];
  const V = makeView(route);
  document.title = `${V.title} · Povolební analýza 2026`;
  const app = $("#app");
  app.replaceChildren();
  const sections = [
    ["vysledky", "Výsledky", secVysledky],
    V.route.kind === "mag" && ["mc", "Městské části", secMC],
    ["mapa", "Mapa okrsků", secMapa],
    ["kandidati", "Přednostní hlasy", secKandidati],
    V.route.kind === "mc" && ["dva-listky", "MČ vs. magistrát", secDvaListky],
    ["korelace", "Korelace", secKorelace],
    S.interni && ["co-delat", "Co dělat příště", secCoDelat, true],
    S.interni && ["konkurence", "Konkurence", secKonkurence, true],
  ].filter(Boolean);
  app.append(heroBlock(V));
  app.append(el("nav", { class: "toc", "aria-label": "Obsah stránky" },
    sections.map(([id, label, , int]) => el("a", { href: `#${id}`, class: int ? "int" : null, onclick: ev => {
      ev.preventDefault(); document.getElementById(id).scrollIntoView({ behavior: "smooth" });
    } }, label))));
  for (const [id, label, fn, int] of sections) {
    const sec = el("section", { class: "card" + (int ? " int" : ""), id });
    sec.append(el("h2", null, label, int ? el("span", { class: "badge" }, "interní") : null));
    app.append(sec);
    try { await fn(V, sec); } catch (e) { console.error(e); sec.append(el("p", { class: "err" }, "Chyba při vykreslení: " + e.message)); }
    if (token !== renderToken) return;
  }
  if (scrollTop) window.scrollTo(0, 0);
}

/* ---------------------------------------------------------------- hero */

function heroBlock(V) {
  const n = V.nase, T = V.T;
  const krizkuNaObalku = T.platne / Math.max(1, T.odevzdane);
  const rank = V.strany.indexOf(n) + 1;
  const tiles = el("div", { class: "tiles" },
    el("div", { class: "tile ours" },
      el("span", { class: "lbl" }, "Náš výsledek"),
      el("span", { class: "val" }, NF2.format(n.p), el("small", null, "%")),
      el("span", { class: "d" }, n.p22 == null ? "kandidátka bez srovnání s 2022" : `${pp(n.d, 2)} proti 2022 (${pct(n.p22, 2)})`)),
    V.full && el("div", { class: "tile" },
      el("span", { class: "lbl" }, "Mandáty"),
      el("span", { class: "val" }, String(n.mandaty), el("small", null, ` z ${V.z.souhrn.mandatu}`)),
      el("span", { class: "d" }, n.mandaty22 == null ? "" : `v roce 2022: ${n.mandaty22}`)),
    el("div", { class: "tile" },
      el("span", { class: "lbl" }, "Pořadí"),
      el("span", { class: "val" }, `${rank}.`),
      el("span", { class: "d" }, `z ${V.strany.length} kandidátek`)),
    el("div", { class: "tile" },
      el("span", { class: "lbl" }, "Hlasy (křížky)"),
      el("span", { class: "val" }, int(n.h)),
      el("span", { class: "d" }, `≈ ${int(n.h / krizkuNaObalku)} voličů (odhad)`)),
    el("div", { class: "tile" },
      el("span", { class: "lbl" }, "Účast"),
      el("span", { class: "val" }, NF1.format(T.ucast), el("small", null, "%")),
      el("span", { class: "d" }, T.ucast22 == null ? "" : `${pp(T.ucast - T.ucast22)} proti 2022`,
        V.idx.some(i => V.ok.volici_odhad[i] != null) ? (S.korekce ? " · zvláštní okrsky přepočteny" : " · včetně zvláštních okrsků") : "")),
  );
  return el("div", null,
    el("div", { class: "hero" },
      el("div", null,
        el("div", { class: "sub", style: "margin:0 0 6px" }, V.kicker),
        el("h1", null, V.title),
        el("div", { class: "sub" }, "Naše kandidátka: ", el("b", null, n.nazev))),
    ),
    tiles);
}

/* ------------------------------------------------------------ výsledky */

function secVysledky(V, sec) {
  sec.append(el("p", { class: "lead" },
    V.full
      ? "Podíl hlasů všech kandidátek a změna proti volbám 2022. Svislá čárka ukazuje výsledek srovnatelné kandidátky z roku 2022 (u koalic součet předchůdců)."
      : "Výsledky voleb do zastupitelstva města Brna sečtené za okrsky této městské části. Svislá čárka = výsledek srovnatelné kandidátky v roce 2022 ve stejných okrscích."));
  const max = Math.max(...V.strany.map(s => Math.max(s.p, s.p22 || 0)));
  const bars = el("div", { class: "bars", role: "list" });
  for (const s of V.strany) {
    const row = el("div", { class: "bar-row" + (s.ours ? " ours" : ""), role: "listitem", tabindex: "0" },
      el("div", { class: "nm" }, el("i", { class: "sw", style: `background:${s.color}` }), el("span", null, s.zkratka)),
      el("div", { class: "track" },
        el("div", { class: "b", style: `width:${s.p / max * 100}%;background:${s.color}` }),
        s.p22 != null && el("div", { class: "t22", style: `left:calc(${s.p22 / max * 100}% - 1px)` })),
      el("div", { class: "v" },
        el("b", null, pct(s.p, 2)),
        el("span", { class: "dlt " + dltClass(s.d) }, s.d == null ? "nová" : pp(s.d)),
        V.full && el("span", { class: "seats", title: "mandáty" }, s.mandaty ? `${s.mandaty} m.` : ""),
      ));
    const showTip = ev => tip.show(ev,
      el("div", null, el("b", null, pct(s.p, 2)), " · ", int(s.h), " hlasů"),
      el("div", null, s.nazev),
      s.p22 != null && el("div", { class: "m" }, `2022: ${pct(s.p22, 2)} (${pp(s.d, 2)})`),
      V.full && el("div", { class: "m" }, `Mandáty: ${s.mandaty}` + (s.mandaty22 != null ? ` (2022: ${s.mandaty22})` : "")),
      s.pozn && el("div", { class: "m" }, s.pozn));
    row.addEventListener("pointermove", showTip);
    row.addEventListener("pointerleave", tip.hide);
    row.addEventListener("focus", ev => { const r = row.getBoundingClientRect(); showTip({ clientX: r.left + 200, clientY: r.top }); });
    row.addEventListener("blur", tip.hide);
    bars.append(row);
    if (s.pozn && (s.ours || s.p >= 3)) bars.append(el("div", { class: "pozn" }, `${s.zkratka}: ${s.pozn}`));
  }
  sec.append(bars);
  sec.append(el("div", { class: "legend" },
    el("span", null, el("i", { class: "kb" }), "2026"),
    el("span", null, el("i", { class: "k22" }), "2022 (srovnatelná kandidátka)"),
    el("span", null, "„nová“ = kandidátka bez předchůdce")));

  const anom = (V.ok.anomalie || []).filter(a => V.idx.includes(V.ok.id.indexOf(a.id)));
  if (anom.length) sec.append(el("p", { class: "note" }, "⚠ Podezřelé zápisy (kandidátka s 3 a více % má v okrsku se 100+ voliči nula hlasů — možná chyba okrskové komise): ",
    anom.map(a => `${(V.strany.find(s => s.por === a.por) || {}).zkratka} v okrsku ${okrsekLabel(V, V.ok.id.indexOf(a.id))}`).join("; "), "."));
  if (V.full) {
    const used = new Set(V.z.strany.flatMap(s => s.z2022));
    const bez = V.z.strany22.filter(s => !used.has(s.por) && s.pct >= 1);
    if (bez.length) sec.append(el("p", { class: "note" },
      "Kandidátky z roku 2022 bez nástupce: ",
      bez.map(s => `${s.zkratka} ${pct(s.pct)}${s.mandaty ? ` (${s.mandaty} m.)` : ""}`).join(", "), "."));
  }
  // tabulka
  const rows = V.strany.map(s => ({ ...s }));
  sec.append(el("details", { class: "tv" }, el("summary", null, "Tabulka výsledků"),
    table([
      { key: "por", label: "Č.", num: true },
      { key: "nazev", label: "Kandidátka", cell: s => [s.nazev, s.pozn && el("span", { class: "small" }, s.pozn)] },
      { key: "h", label: "Hlasy", num: true, fmt: int },
      { key: "p", label: "2026", num: true, fmt: v => pct(v, 2) },
      { key: "p22", label: "2022", num: true, fmt: v => pct(v, 2) },
      { key: "d", label: "Změna", num: true, fmt: v => pp(v, 2) },
      V.full && { key: "mandaty", label: "Mandáty", num: true },
      V.full && { key: "mandaty22", label: "2022", num: true, fmt: v => v == null ? "–" : v },
    ].filter(Boolean), rows, { rowClass: s => s.ours ? "ours" : "" })));
}

/* -------------------------------------------------------------- tabulka */

function table(cols, rows, opt = {}) {
  let sortKey = opt.sortKey || null, asc = opt.asc ?? false;
  const tb = el("tbody");
  const thead = el("thead", null, el("tr", null, cols.map(c => {
    const th = el("th", { class: c.num ? "r" : "", scope: "col", tabindex: "0" }, c.label);
    const go = () => { if (sortKey === c.key) asc = !asc; else { sortKey = c.key; asc = !c.num; } draw(); };
    th.addEventListener("click", go);
    th.addEventListener("keydown", e => { if (e.key === "Enter") go(); });
    th._key = c.key;
    return th;
  })));
  let showAll = !opt.limit;
  const more = el("button", { type: "button", class: "pill", style: "margin-top:8px" });
  more.addEventListener("click", () => { showAll = !showAll; draw(); });
  function draw() {
    let rs = rows;
    if (sortKey) {
      const c = cols.find(c => c.key === sortKey);
      const get = c.sortVal || (r => r[sortKey]);
      rs = [...rows].sort((a, b) => {
        const x = get(a), y = get(b);
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        const r = typeof x === "string" ? x.localeCompare(y, "cs") : x - y;
        return asc ? r : -r;
      });
    }
    for (const th of thead.querySelectorAll("th")) {
      if (th._key === sortKey) th.setAttribute("aria-sort", asc ? "ascending" : "descending");
      else th.removeAttribute("aria-sort");
    }
    if (opt.limit) {
      more.hidden = rows.length <= opt.limit;
      more.textContent = showAll ? "Zobrazit méně" : `Zobrazit všech ${rows.length}`;
      if (!showAll) rs = rs.slice(0, opt.limit);
    }
    tb.replaceChildren(...rs.map(r => {
      const tr = el("tr", { class: [opt.rowClass ? opt.rowClass(r) : "", opt.onRow ? "click" : ""].join(" ").trim() || null },
        cols.map(c => el("td", { class: c.num ? "r" : "" },
          c.cell ? c.cell(r) : c.fmt ? c.fmt(r[c.key], r) : (r[c.key] ?? "–"))));
      if (opt.onRow) tr.addEventListener("click", () => opt.onRow(r, tr));
      return tr;
    }));
  }
  draw();
  return el("div", null, el("div", { class: "tbl-wrap" }, el("table", { class: "t" }, thead, tb)), opt.limit ? more : null);
}

/* ------------------------------------------------- městské části (MČ) */

function secMC(V, sec) {
  sec.append(el("p", { class: "lead" },
    "Výsledek kandidátky do zastupitelstva města v jednotlivých městských částech. Prázdné kolečko = 2022, plné = 2026, svislá čára = průměr Brna. Kliknutím na řádek otevřete detail městské části."));
  const ctrl = el("div", { class: "ctrl" });
  const sel = el("select", { "aria-label": "Kandidátka" },
    V.strany.filter(s => s.p >= 1).map(s => el("option", { value: s.por, selected: s.ours ? true : null }, s.zkratka)));
  ctrl.append(el("label", null, "Kandidátka", sel));
  const seg = segmented([["p", "Řadit podle 2026"], ["d", "podle změny"], ["volici", "podle velikosti"]], "p");
  ctrl.append(seg.el);
  sec.append(ctrl);
  const box = el("div");
  sec.append(box);
  const tv = el("div");
  sec.append(tv);
  function draw() {
    const por = +sel.value;
    const s = V.strany.find(x => x.por === por);
    const color = s.color;
    const ok = V.ok;
    const rows = V.z.mc.map(m => {
      const ii = V.idx.filter(i => ok.mc[i] === m.kod);
      m = { ...m, volici: ii.reduce((a, i) => a + vol(ok, i), 0) };
      m.ucast = sum(ok.obalky, ii) / m.volici * 100;
      const p = m.hlasy[por] / m.platne * 100;
      const p22 = m.hlasy22[por] != null ? m.hlasy22[por] / m.platne22 * 100 : null;
      return { ...m, p, p22, d: p22 == null ? null : p - p22, idx: p / s.p * 100 };
    });
    const key = seg.value;
    rows.sort((a, b) => (b[key] ?? -1e9) - (a[key] ?? -1e9));
    const max = Math.ceil(Math.max(...rows.map(r => Math.max(r.p, r.p22 || 0))) / 5) * 5;
    const X = v => `${v / max * 100}%`;
    const db = el("div", { class: "db" });
    for (const r of rows) {
      const lo = r.p22 == null ? r.p : Math.min(r.p, r.p22), hi = r.p22 == null ? r.p : Math.max(r.p, r.p22);
      const row = el("div", { class: "db-row", tabindex: "0", role: "link" },
        el("div", { class: "nm" }, r.nazev),
        el("div", { class: "tr" },
          el("div", { class: "avg", style: `left:${X(s.p)}` }),
          el("div", { class: "ln", style: `left:${X(lo)};width:calc(${X(hi)} - ${X(lo)})` }),
          r.p22 != null && el("div", { class: "d22", style: `left:${X(r.p22)}` }),
          el("div", { class: "d26", style: `left:${X(r.p)};background:${color}` })),
        el("div", { class: "v" }, el("b", null, pct(r.p)), " ", el("span", { class: "dlt " + dltClass(r.d) }, r.d == null ? "" : pp(r.d))));
      row.addEventListener("click", () => { location.hash = `#/mag/${r.kod}`; });
      row.addEventListener("keydown", e => { if (e.key === "Enter") location.hash = `#/mag/${r.kod}`; });
      row.addEventListener("pointermove", ev => tip.show(ev,
        el("div", null, el("b", null, pct(r.p, 2)), " ", r.nazev),
        el("div", { class: "m" }, `2022: ${pct(r.p22, 2)} · změna ${pp(r.d, 2)}`),
        el("div", { class: "m" }, `Index vůči Brnu: ${int(r.idx)} · ${int(r.volici)} voličů · účast ${pct(r.ucast)}`)));
      row.addEventListener("pointerleave", tip.hide);
      db.append(row);
    }
    const ticks = [];
    for (let t = 0; t <= max; t += max > 20 ? 10 : 5) ticks.push(el("span", { style: `left:${X(t)}` }, `${t} %`));
    db.append(el("div", { class: "db-axis" }, el("span"), el("div", { class: "ax" }, ticks), el("span")));
    box.replaceChildren(db);
    tv.replaceChildren(el("details", { class: "tv" }, el("summary", null, "Tabulka městských částí"),
      table([
        { key: "nazev", label: "MČ" },
        { key: "okrsku", label: "Okrsků", num: true },
        { key: "volici", label: "Voličů", num: true, fmt: int },
        { key: "ucast", label: "Účast", num: true, fmt: v => pct(v) },
        { key: "p", label: "2026", num: true, fmt: v => pct(v, 2) },
        { key: "p22", label: "2022", num: true, fmt: v => pct(v, 2) },
        { key: "d", label: "Změna", num: true, fmt: v => pp(v, 2) },
        { key: "idx", label: "Index (Brno = 100)", num: true, fmt: int },
      ], rows, { sortKey: key, onRow: r => { location.hash = `#/mag/${r.kod}`; } })));
  }
  sel.addEventListener("change", draw);
  seg.onChange = draw;
  draw();
}

function segmented(opts, value) {
  const o = { value, onChange: null };
  o.el = el("div", { class: "seg", role: "group" }, opts.map(([v, l]) => {
    const b = el("button", { type: "button", class: v === value ? "on" : null, "aria-pressed": v === value ? "true" : "false" }, l);
    b.addEventListener("click", () => {
      o.value = v;
      for (const x of o.el.children) { x.classList.remove("on"); x.setAttribute("aria-pressed", "false"); }
      b.classList.add("on"); b.setAttribute("aria-pressed", "true");
      o.onChange && o.onChange(v);
    });
    return b;
  }));
  return o;
}

/* ------------------------------------------------------------- mapy */

function newMap(container) {
  const m = L.map(container, { scrollWheelZoom: false, zoomSnap: 0.25, attributionControl: true });
  const base = S.theme === "dark" ? "Dark_Gray_Base" : "Light_Gray_Base";
  L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${base}/MapServer/tile/{z}/{y}/{x}`, {
    attribution: 'Podklad &copy; <a href="https://www.esri.com/">Esri</a>, HERE, Garmin, &copy; přispěvatelé OpenStreetMap',
    maxZoom: 16,
  }).addTo(m);
  S.maps.push(m);
  return m;
}

/* Škála: {color(v), legend} — sekvenční (kvantily) nebo divergentní (symetrická). */
function seqScale(values) {
  const v = values.filter(x => x != null && isFinite(x)).sort((a, b) => a - b);
  const n = SEQ.length;
  const br = [];
  for (let i = 1; i < n; i++) br.push(v.length ? v[Math.min(v.length - 1, Math.floor(i / n * v.length))] : 0);
  const color = x => {
    if (x == null || !isFinite(x)) return NODATA[S.theme];
    let k = 0; while (k < br.length && x > br[k]) k++;
    return SEQ[k];
  };
  return { color, colors: SEQ, breaks: br, min: v[0], max: v[v.length - 1] };
}
function divScale(values, center = 0, fixed) {
  const v = values.filter(x => x != null && isFinite(x));
  let m = fixed || Math.max(...v.map(x => Math.abs(x - center)), 0.0001);
  if (!fixed) { const s = [...v].map(x => Math.abs(x - center)).sort((a, b) => a - b); m = s[Math.floor(s.length * 0.95)] || m; }
  const steps = [0.1, 0.35, 0.65, 1].map(f => f * m);
  const color = x => {
    if (x == null || !isFinite(x)) return NODATA[S.theme];
    const d = x - center, a = Math.abs(d);
    if (a <= steps[0]) return MID[S.theme];
    let k = 1; while (k < 3 && a > steps[k]) k++;
    return d > 0 ? DIV_POS[k] : DIV_NEG[3 - k];
  };
  const colors = [DIV_NEG[0], DIV_NEG[1], DIV_NEG[2], MID[S.theme], DIV_POS[1], DIV_POS[2], DIV_POS[3]];
  return { color, colors, div: true, m, center };
}

function scaleLegend(sc, fmt, title) {
  let labels;
  if (sc.div) labels = [fmt(sc.center - sc.m), fmt(sc.center), fmt(sc.center + sc.m)];
  else labels = [fmt(sc.min), fmt(sc.breaks[Math.floor(sc.breaks.length / 2)]), fmt(sc.max)];
  return el("div", { class: "scale" },
    el("span", null, title),
    el("div", null,
      el("div", { class: "sb" }, sc.colors.map(c => el("i", { style: `background:${c}` }))),
      el("div", { class: "lab" }, labels.map(l => el("span", null, l)))),
    el("span", null, el("i", { style: `display:inline-block;width:14px;height:10px;border:1px solid var(--line);background:${NODATA[S.theme]};vertical-align:middle;margin-right:4px` }), "bez dat"));
}

/* Vrstva okrsků: ids, value(i) → barva přes scale, tooltip(i), click(i). */
function okrskyLayer(map, V, idxs, colorOf, onTip, onClick, opts = {}) {
  const feats = [];
  const lookup = new Map();
  for (const i of idxs) {
    const f = S.geoById.get(V.ok.id[i]);
    if (!f) continue;
    feats.push(f);
    lookup.set(f.properties.id, i);
  }
  let selected = null;
  const layer = L.geoJSON({ type: "FeatureCollection", features: feats }, {
    style: f => ({
      fillColor: colorOf(lookup.get(f.properties.id)), fillOpacity: opts.opacity ?? 0.82,
      color: S.theme === "dark" ? "#0e0e0e" : "#ffffff", weight: 0.8,
    }),
    onEachFeature: (f, lyr) => {
      const i = lookup.get(f.properties.id);
      lyr.on("mousemove", e => tip.show(e.originalEvent, ...onTip(i)));
      lyr.on("mouseout", () => tip.hide());
      lyr.on("click", () => {
        if (selected) layer.resetStyle(selected);
        selected = lyr;
        lyr.setStyle({ weight: 3, color: S.theme === "dark" ? "#fff" : "#000" });
        lyr.bringToFront();
        onClick && onClick(i);
      });
    },
  }).addTo(map);
  if (feats.length) map.fitBounds(layer.getBounds(), { padding: [10, 10] });
  layer.recolor = fn => { colorOf = fn; layer.setStyle(f => ({ fillColor: fn(lookup.get(f.properties.id)) })); if (selected) selected.setStyle({ weight: 3 }); };
  return layer;
}

function okrsekLabel(V, i) {
  const n = V.ok.nazev[i];
  return n ? `${V.ok.id[i].split("-")[1]} · ${n}` : `okrsek ${V.ok.id[i]}`;
}

function sharesAt(V, i, year) {
  const ok = V.ok;
  if (year === 2022) {
    const pl = ok.platne22[i];
    return V.strany.map(s => ({ s, p: ok.hlasy22[s.por] && pl ? ok.hlasy22[s.por][i] / pl * 100 : null }));
  }
  return V.strany.map(s => ({ s, p: ok.platne[i] ? ok.hlasy[s.por][i] / ok.platne[i] * 100 : null }));
}

function okrsekPanel(V, i) {
  const ok = V.ok;
  const u = ucastAt(ok, i);
  const u22 = ucast22At(ok, i);
  const s26 = sharesAt(V, i, 2026), s22 = sharesAt(V, i, 2022);
  const rows = s26.map((x, k) => ({ ...x, p22: s22[k].p })).filter(x => x.p >= 0.5 || x.s.ours).sort((a, b) => b.p - a.p);
  return el("div", null,
    el("h3", null, okrsekLabel(V, i)),
    el("div", { class: "muted" }, ok.ulice[i] || ""),
    el("div", { style: "margin-top:6px" }, `${int(vol(ok, i))} voličů${S.korekce && ok.volici_odhad[i] != null ? ` (odhad; v seznamu ${int(ok.volici[i])})` : ""} · účast ${pct(u)}`, u22 != null ? ` (2022: ${pct(u22)})` : ""),
    !ok.spolehlive[i] && el("div", { class: "muted" }, "⚠ Okrsek se od roku 2022 změnil, srovnání je orientační."),
    ok.zvlastni[i] && el("div", { class: "muted" }, "⚠ Zvláštní okrsek (voliči s evidenční adresou na úřadě)."),
    ...(ok.anomalie || []).filter(a => a.id === ok.id[i]).map(a => el("div", { class: "muted" },
      `⚠ Podezřelý zápis: ${(V.strany.find(s => s.por === a.por) || {}).zkratka} zde má podle úředních dat 0 hlasů.`)),
    el("table", null, el("tbody", null, rows.map(x => el("tr", null,
      el("td", null, el("i", { class: "sw", style: `display:inline-block;margin-right:6px;background:${x.s.color}` }), x.s.ours ? el("b", null, x.s.zkratka) : x.s.zkratka),
      el("td", { class: "r" }, pct(x.p)),
      el("td", { class: "r" }, el("span", { class: "dlt " + dltClass(x.p22 == null ? null : x.p - x.p22) }, x.p22 == null || !ok.spolehlive[i] ? "" : pp(x.p - x.p22))))))));
}

function secMapa(V, sec) {
  sec.append(el("p", { class: "lead" },
    "Výsledky po volebních okrscích. Vyberte kandidátku a ukazatel; kliknutím na okrsek zobrazíte jeho výsledky. Barevné třídy u podílu jsou kvantily (každá třída obsahuje zhruba stejný počet okrsků)."));
  const ctrl = el("div", { class: "ctrl" });
  const sel = el("select", { "aria-label": "Kandidátka" },
    V.strany.filter(s => s.p >= 1 || s.ours).map(s => el("option", { value: s.por, selected: s.ours ? true : null }, s.zkratka)));
  const seg = segmented([["p", "Podíl 2026"], ["d", "Změna od 2022"], ["u", "Účast"], ["du", "Změna účasti"]], "p");
  ctrl.append(el("label", null, "Kandidátka", sel), seg.el);
  sec.append(ctrl);
  const mapEl = el("div", { class: "map" });
  const panel = el("div", { class: "side-panel" });
  sec.append(el("div", { class: "map-wrap" }, el("div", null, mapEl, el("div", { class: "legend-box" })), panel));
  const tv = el("div");
  sec.append(tv);
  const map = newMap(mapEl);
  const ok = V.ok;
  const metric = (i, key, por) => {
    if (key === "u") return ucastAt(ok, i);
    if (key === "du") return (ok.spolehlive[i] || (S.korekce && ok.zvlastni[i])) && ucast22At(ok, i) != null ? ucastAt(ok, i) - ucast22At(ok, i) : null;
    const p = ok.platne[i] ? ok.hlasy[por][i] / ok.platne[i] * 100 : null;
    if (key === "p") return p;
    if (!ok.hlasy22[por] || !ok.spolehlive[i] || !ok.platne22[i]) return null;
    return p - ok.hlasy22[por][i] / ok.platne22[i] * 100;
  };
  const idxNoZv = V.idx.filter(i => !ok.zvlastni[i]);
  const showZv = key => S.korekce && (key === "u" || key === "du");
  let layer, vals = new Map();
  function legendAndPanel() {
    const por = +sel.value, key = seg.value, s = V.strany.find(x => x.por === por);
    const lab = { p: `Podíl: ${s.zkratka}`, d: `Změna podílu ${s.zkratka} (p. b.)`, u: "Účast", du: "Změna účasti (p. b.)" }[key];
    const values = idxNoZv.map(i => vals.get(i));
    const sc = key === "p" || key === "u" ? seqScale(values) : divScale(values);
    const fmt = key === "p" || key === "u" ? v => pct(v) : v => (v > 0 ? "+" : v < 0 ? "−" : "") + NF1.format(Math.abs(v));
    return { sc, fmt, lab, s, key };
  }
  function draw() {
    const por = +sel.value, key = seg.value;
    vals = new Map(V.idx.map(i => [i, metric(i, key, por)]));
    const { sc, fmt, lab, s } = legendAndPanel();
    const colorOf = i => ok.zvlastni[i] && !showZv(key) ? NODATA[S.theme] : sc.color(vals.get(i));
    const tipOf = i => [
      el("div", null, el("b", null, key === "p" || key === "u" ? pct(vals.get(i), 2) : pp(vals.get(i), 2)), " ", el("span", { class: "m" }, lab)),
      el("div", null, okrsekLabel(V, i)),
      el("div", { class: "m" }, `${int(vol(ok, i))} voličů`)];
    if (!layer) layer = okrskyLayer(map, V, V.idx, colorOf, tipOf, i => panel.replaceChildren(okrsekPanel(V, i)));
    else { layer.recolor(colorOf); layer.off("mousemove"); }
    layer.eachLayer(l => {
      const i = V.idx.find(j => ok.id[j] === l.feature.properties.id);
      l.off("mousemove"); l.on("mousemove", e => tip.show(e.originalEvent, ...tipOf(i)));
    });
    mapEl.nextSibling.replaceChildren(scaleLegend(sc, fmt, lab));
    // výchozí panel: nejsilnější a nejslabší okrsky
    const ranked = (showZv(key) ? V.idx : idxNoZv).filter(i => vals.get(i) != null).sort((a, b) => vals.get(b) - vals.get(a));
    const li = i => el("li", null, `${okrsekLabel(V, i)} — `, el("b", null, key === "p" || key === "u" ? pct(vals.get(i)) : pp(vals.get(i))));
    panel.replaceChildren(el("div", null,
      el("h3", null, lab),
      el("div", { class: "muted" }, "Klikněte na okrsek v mapě pro detail."),
      el("p", { style: "margin:10px 0 4px;font-weight:700" }, "Nejvyšší hodnoty"),
      el("ol", { style: "margin:0;padding-left:20px" }, ranked.slice(0, 6).map(li)),
      el("p", { style: "margin:10px 0 4px;font-weight:700" }, "Nejnižší hodnoty"),
      el("ol", { style: "margin:0;padding-left:20px" }, ranked.slice(-6).reverse().map(li))));
    // tabulka
    const rows = V.idx.map(i => ({
      i, id: ok.id[i], nazev: okrsekLabel(V, i), volici: vol(ok, i),
      u: ucastAt(ok, i), p: metric(i, "p", por), d: metric(i, "d", por),
    }));
    tv.replaceChildren(el("details", { class: "tv" }, el("summary", null, `Tabulka okrsků (${rows.length})`),
      table([
        { key: "nazev", label: "Okrsek" },
        { key: "volici", label: "Voličů", num: true, fmt: int },
        { key: "u", label: "Účast", num: true, fmt: v => pct(v) },
        { key: "p", label: s.zkratka, num: true, fmt: v => pct(v, 2) },
        { key: "d", label: "Změna", num: true, fmt: v => pp(v, 2) },
      ], rows, { sortKey: "p" })));
  }
  sel.addEventListener("change", draw);
  seg.onChange = draw;
  draw();
  setTimeout(() => map.invalidateSize(), 50);
}

/* --------------------------------------------------- přednostní hlasy */

async function loadKand(kod, por) {
  const k = `${kod}-${por}`;
  if (!S.kand[k]) S.kand[k] = await getJSON(`data/kandidati/${k}.json`);
  return S.kand[k];
}

const OKNO = 5; // porovnání s kandidáty ±5 míst

function q25(a) {
  const s = [...a].sort((x, y) => x - y), k = (s.length - 1) * 0.25, f = Math.floor(k);
  return s[f] + ((s[Math.min(f + 1, s.length - 1)] - s[f]) * (k - f));
}

function osobniHlasy(KF, idx) {
  // Osobní hlasy = hlasy kandidáta nad „základem“ v okrsku. Základ = dolní čtvrtina
  // hlasů kandidátů do ±5 míst na kandidátce (bez něj) — hlasy z označení strany
  // s pořadím ubývají (smíšené lístky), proto se nesrovnává s celou kandidátkou.
  // U krajních míst se okno posouvá (pro 1. místo = místa 2–6).
  const kand = KF.kandidati, n = kand.length;
  const extra = kand.map(() => new Map());
  for (const i of idx) {
    const v = kand.map(k => k.okrsky[i]);
    kand.forEach((k, c) => {
      const lo = Math.max(0, Math.min(c - OKNO, n - 2 * OKNO - 1)), hi = Math.min(n, lo + 2 * OKNO + 1);
      const nb = [];
      for (let j = lo; j < hi; j++) if (j !== c) nb.push(v[j]);
      extra[c].set(i, nb.length ? Math.max(0, v[c] - q25(nb)) : 0);
    });
  }
  return extra;
}

async function secKandidati(V, sec) {
  sec.append(el("p", { class: "lead" },
    "V komunálních volbách volič buď označí celou kandidátku (hlas dostanou všichni její kandidáti), nebo dá křížky jednotlivým kandidátům, případně obojí. Kdo označí stranu a zároveň dá křížky kandidátům jiných stran, dává hlas jen horní části kandidátky — hlasy proto s pořadím přirozeně ubývají. ",
    el("b", null, "Osobní hlasy"), " proto počítáme v každém okrsku jako hlasy kandidáta nad základem jeho okolí na kandidátce (dolní čtvrtina hlasů kandidátů do 5 míst nad ním a pod ním) — přibližně tolik voličů ho zakřížkovalo jménem. U prvního místa se srovnává s místy 2–6, odhad je tam proto mírně nadsazený. Kandidáta vyberte v rozbalovacím seznamu vedle mapy (nebo kliknutím na řádek tabulky)."));
  const ctrl = el("div", { class: "ctrl" });
  const sel = el("select", { "aria-label": "Kandidátka" },
    V.strany.filter(s => s.kandidatu > 0).map(s => el("option", { value: s.por, selected: s.ours ? true : null }, `${s.zkratka} (${pct(s.p)})`)));
  ctrl.append(el("label", null, "Kandidátka", sel));
  sec.append(ctrl);
  const body = el("div");
  sec.append(body);
  async function draw() {
    const por = +sel.value;
    const s = V.strany.find(x => x.por === por);
    body.replaceChildren(el("p", { class: "loading" }, "Načítám kandidáty…"));
    const KF = await loadKand(V.z.kod, por);
    const extra = osobniHlasy(KF, V.idx);
    const L = new Map(V.idx.map(i => [i, KF.okrsky_hlasy[i]]));
    const Ltot = V.idx.reduce((a, i) => a + L.get(i), 0);
    const rows = KF.kandidati.map((k, c) => {
      const h = V.full ? k.hlasy : sum(k.okrsky, V.idx);
      let E = 0; for (const v of extra[c].values()) E += v;
      const navrhla = stranaNazev(k.nstrana, "cns"), prisl = stranaNazev(k.pstrana, "cpp");
      return { ...k, ci: c, h, E, preskok: k.mandat && k.c > s.mandaty,
        prisl: (prisl === "BEZPP" ? "bez PP" : prisl) + (navrhla !== prisl ? ` (navrhla ${navrhla})` : "") };
    });
    const byH = [...rows].sort((a, b) => b.h - a.h);
    byH.forEach((r, k) => { r.rankH = k + 1; });
    const byE = [...rows].sort((a, b) => b.E - a.E);
    byE.forEach((r, k) => { r.rankE = k + 1; });

    const mapEl = el("div", { class: "map" });
    const panel = el("div", { class: "side-panel" });
    const legendBox = el("div");
    // Výběr kandidáta: řazeno podle čísla na kandidátce
    const candSel = el("select", { class: "cand-sel", "aria-label": "Kandidát" },
      el("optgroup", { label: "Pořadí na kandidátce · osobní hlasy v závorce · ✓ = mandát" },
        [...rows].sort((a, b) => a.c - b.c).map(r => el("option", { value: r.ci }, `${r.c}. ${r.jmeno.replace(/^((?:[A-Za-zÁ-ž]+\.\s?)+)\s*/, "").replace(/,.*$/, "")} (${int(r.E)})${r.mandat ? " ✓" : ""}`))));
    candSel.addEventListener("change", () => showCand(rows[+candSel.value]));
    const side = el("div", { class: "side-col" },
      el("label", { class: "cand-lbl" }, el("span", null, "Kandidát"), candSel), panel);
    const map = newMap(mapEl);
    let layer = null, current = null;

    function showCand(r) {
      current = r;
      const E = r.E;
      const idxv = new Map(V.idx.map(i => {
        const e = extra[r.ci].get(i), Li = L.get(i);
        return [i, E > 0 && Li > 0 && Ltot > 0 ? e / (E * Li / Ltot) * 100 : null];
      }));
      const sc = divScale([...idxv.values()].map(v => v == null ? null : Math.log2(Math.max(v, 1) / 100)), 0, 1.5);
      const colorOf = i => idxv.get(i) == null ? NODATA[S.theme] : sc.color(Math.log2(Math.max(idxv.get(i), 1) / 100));
      const tipOf = i => [
        el("div", null, el("b", null, int(extra[r.ci].get(i))), " osobních hlasů · index ", el("b", null, int(idxv.get(i)))),
        el("div", null, okrsekLabel(V, i)),
        el("div", { class: "m" }, `${int(KF.kandidati[r.ci].okrsky[i])} hlasů celkem, kandidátka ${int(L.get(i))}`)];
      if (layer) map.removeLayer(layer);
      layer = okrskyLayer(map, V, V.idx, colorOf, tipOf, i => panel.replaceChildren(okrsekKandPanel(V, KF, extra, i)));
      legendBox.replaceChildren(el("div", { class: "scale" },
        el("span", null, `Index osobních hlasů: ${r.jmeno}`),
        el("div", null,
          el("div", { class: "sb" }, sc.colors.map(c => el("i", { style: `background:${c}` }))),
          el("div", { class: "lab" }, el("span", null, "≤ 35"), el("span", null, "100 = průměr"), el("span", null, "≥ 280")))));
      const top = V.idx.filter(i => !V.ok.zvlastni[i]).sort((a, b) => extra[r.ci].get(b) - extra[r.ci].get(a)).slice(0, 10);
      panel.replaceChildren(el("div", null,
        el("h3", null, `${r.c}. ${r.jmeno}`),
        el("div", { class: "muted" }, [r.vek && `${r.vek} let`, r.povolani, r.prisl].filter(Boolean).join(" · ")),
        el("div", { style: "margin-top:8px" }, `${int(r.h)} hlasů · ${int(r.E)} osobních · ${r.rankH}. podle hlasů`),
        r.mandat ? el("div", null, el("span", { class: "mand" }, "mandát"), r.preskok ? " · přeskočil(a) pořadí díky preferenčním hlasům" : "")
          : r.nahradnik ? el("div", { class: "muted" }, `${r.nahradnik}. náhradník`) : null,
        r.r2022 && el("div", { class: "muted", style: "margin-top:4px" }, `2022: ${r.r2022.c}. na kandidátce ${r.r2022.kandidatka}, ${int(r.r2022.hlasy)} hlasů${r.r2022.mandat ? ", mandát" : ""}`),
        el("p", { style: "margin:10px 0 4px;font-weight:700" }, "Nejvíc osobních hlasů"),
        el("ol", { style: "margin:0;padding-left:20px" }, top.map(i => el("li", null, `${okrsekLabel(V, i)} — `, el("b", null, int(extra[r.ci].get(i))), el("span", { class: "muted" }, ` (index ${int(idxv.get(i))})`)))),
        el("p", { class: "muted", style: "margin-top:10px" }, "Index 100 = kandidát má v okrsku stejný podíl osobních hlasů jako na celém území; 200 = dvojnásobek. U malých okrsků je index nestabilní.")));
      for (const tr of tbl.querySelectorAll("tr.sel")) tr.classList.remove("sel");
      candSel.value = String(r.ci);
    }

    const tbl = table([
      { key: "c", label: "Č.", num: true },
      { key: "jmeno", label: "Kandidát", cell: r => [r.jmeno, el("span", { class: "small" }, [r.vek && `${r.vek} let`, r.povolani, r.prisl].filter(Boolean).join(" · "))] },
      { key: "h", label: V.full ? "Hlasy" : "Hlasy v MČ", num: true, fmt: int },
      { key: "E", label: "Osobní", num: true, fmt: int },
      { key: "rankH", label: "Pořadí", num: true, fmt: v => `${v}.` },
      { key: "mandat", label: "Výsledek", sortVal: r => r.mandat ? 1000 - (r.poradi || 0) : r.nahradnik ? -r.nahradnik : -1000,
        cell: r => r.mandat ? el("span", { class: "mand" }, r.preskok ? "mandát ↑" : "mandát") : r.nahradnik ? el("span", { class: "mand n" }, `${r.nahradnik}. náhr.`) : "" },
      { key: "r22", label: "2022", sortVal: r => r.r2022 ? r.r2022.hlasy : null,
        cell: r => r.r2022 ? [int(r.r2022.hlasy) + (r.r2022.mandat ? " ✓" : ""), el("span", { class: "small" }, `${r.r2022.c}. místo` + (V.z.strany22.some(x => x.nazev === r.r2022.kandidatka && s.z2022.includes(x.por)) ? "" : ` · ${r.r2022.kandidatka}`))] : "" },
    ], rows, { limit: 15, onRow: (r, tr) => { showCand(r); tr.classList.add("sel"); mapEl.scrollIntoView({ behavior: "smooth", block: "center" }); } });

    body.replaceChildren(
      el("div", { class: "map-wrap" }, el("div", null, mapEl, legendBox), side),
      el("h3", { style: "margin:18px 0 6px" }, `Kandidáti: ${s.nazev}`),
      el("p", { class: "note", style: "margin:0 0 8px" }, "„mandát ↑“ = kandidát získal mandát, přestože podle pořadí na kandidátce by nebyl zvolen (posun díky preferenčním hlasům). ✓ ve sloupci 2022 = tehdy zvolen."),
      tbl);
    setTimeout(() => map.invalidateSize(), 50);
    showCand(byE[0]);
  }
  sel.addEventListener("change", draw);
  await draw();
}

function okrsekKandPanel(V, KF, extra, i) {
  const rows = KF.kandidati.map((k, c) => ({ k, e: extra[c].get(i), h: k.okrsky[i] })).sort((a, b) => b.e - a.e).slice(0, 10);
  return el("div", null,
    el("h3", null, okrsekLabel(V, i)),
    el("div", { class: "muted" }, `Kandidátka zde: ${int(KF.okrsky_hlasy[i])} hlasů`),
    el("p", { style: "margin:10px 0 4px;font-weight:700" }, "Kdo zde získal nejvíc osobních hlasů"),
    el("table", null, el("tbody", null, rows.map(r => el("tr", null,
      el("td", null, `${r.k.c}. ${r.k.jmeno}`), el("td", { class: "r" }, el("b", null, int(r.e))), el("td", { class: "r muted" }, int(r.h)))))));
}

/* --------------------------------------------------------- korelace */

function korelPromenne(V) {
  const ok = V.ok;
  const sk = new Set(["pirati", "luzanky"]);
  const vyber = V.strany.filter(s => s.p >= 3 || s.ours || (sk.has(s.skupina) && s.p >= 0.5));
  const share = s => ok.id.map((_, i) => ok.platne[i] ? ok.hlasy[s.por][i] / ok.platne[i] * 100 : NaN);
  const share22 = s => ok.id.map((_, i) => ok.hlasy22[s.por] && ok.platne22[i] ? ok.hlasy22[s.por][i] / ok.platne22[i] * 100 : NaN);
  const ucast = ok.id.map((_, i) => ok.obalky[i] / ok.volici[i] * 100);
  const ucast22 = ok.id.map((_, i) => ok.volici22[i] ? ok.obalky22[i] / ok.volici22[i] * 100 : NaN);
  const lev = vyber.map(s => ({ key: String(s.por), label: s.zkratka, s, x: share(s), d: ok.hlasy22[s.por] ? share(s).map((v, i) => ok.spolehlive[i] ? v - share22(s)[i] : NaN) : null }));
  lev.push({ key: "u", label: "Účast", x: ucast, d: ucast.map((v, i) => ok.spolehlive[i] ? v - ucast22[i] : NaN) });
  return lev;
}

function secKorelace(V, sec) {
  const ok = V.ok;
  const inIdx = new Set(V.idx.filter(i => !ok.zvlastni[i]));
  const w = ok.id.map((_, i) => inIdx.has(i) ? ok.platne[i] : 0);
  const n = inIdx.size;
  sec.append(el("p", { class: "lead" },
    "Jak spolu souvisí výsledky stran napříč okrsky (vážená Pearsonova korelace, váha = počet platných hlasů). ",
    el("b", null, "Kladná"), " hodnota: strany jsou silné ve stejných okrscích (podobný elektorát, soupeří o podobné voliče). ",
    el("b", null, "Záporná"), ": kde je silná jedna, je slabá druhá. Druhá matice porovnává ", el("b", null, "změny"),
    " od roku 2022: záporná korelace změn naznačuje, že kde jedna strana získala, druhá ztratila."));
  if (n < MIN_KOREL) {
    sec.append(el("p", { class: "note" }, `Celek má jen ${n} okrsků — korelace by nebyla spolehlivá, proto ji nepočítáme. Viz korelace pro celé Brno nebo pro větší městskou část.`));
    return;
  }
  const P = korelPromenne(V);
  const scatterBox = el("div", { class: "scatter" });
  const mk = (title, vars, getter) => {
    const M = vars.map(a => vars.map(b => a === b ? null : wcorr(getter(a), getter(b), w)));
    const t = el("table", { class: "hm" },
      el("thead", null, el("tr", null, el("th"), vars.map(v => el("th", { scope: "col" }, v.label)))),
      el("tbody", null, vars.map((a, r) => el("tr", null, el("th", { scope: "row" }, a.label),
        vars.map((b, c) => {
          const v = M[r][c];
          if (r === c) return el("td", { class: "diag" });
          const col = v == null ? "transparent" : v > 0 ? `rgba(42,120,214,${Math.min(1, Math.abs(v) * 1.25)})` : `rgba(227,73,72,${Math.min(1, Math.abs(v) * 1.25)})`;
          const td = el("td", { style: `background:${col};color:${Math.abs(v || 0) > 0.45 ? "#fff" : "var(--fg)"}`, tabindex: "0" }, v == null ? "–" : r2(v));
          const go = () => { for (const x of document.querySelectorAll(".hm td.sel")) x.classList.remove("sel"); td.classList.add("sel"); scatter(V, a, b, getter, w, v, scatterBox, title); };
          td.addEventListener("click", go);
          td.addEventListener("keydown", e => { if (e.key === "Enter") go(); });
          td.addEventListener("pointermove", ev => tip.show(ev, el("div", null, el("b", null, r2(v))), el("div", null, `${a.label} × ${b.label}`), el("div", { class: "m" }, korelSlovy(v))));
          td.addEventListener("pointerleave", tip.hide);
          return td;
        })))));
    return { el: el("div", null, el("h3", { style: "margin:0 0 6px" }, title), el("div", { class: "tbl-wrap" }, t)), M };
  };
  const A = mk("Podíly 2026", P, v => v.x);
  const Pd = P.filter(v => v.d);
  const B = mk("Změny 2022 → 2026", Pd, v => v.d);
  sec.append(el("div", { class: "grid2" }, A.el, B.el));
  sec.append(el("div", { class: "legend" },
    el("span", null, el("i", { style: "width:14px;height:10px;background:rgba(227,73,72,.9)" }), "záporná"),
    el("span", null, el("i", { style: "width:14px;height:10px;background:var(--soft)" }), "≈ 0"),
    el("span", null, el("i", { style: "width:14px;height:10px;background:rgba(42,120,214,.9)" }), "kladná"),
    el("span", null, `Okrsků: ${n}. Kliknutím na buňku zobrazíte bodový graf.`)));
  // slovní shrnutí pro naši kandidátku
  const ours = P.findIndex(v => v.s && v.s.ours);
  if (ours >= 0) {
    const rel = P.map((v, k) => ({ v, r: A.M[ours][k] })).filter(x => x.r != null && x.v.s);
    rel.sort((a, b) => b.r - a.r);
    const items = [];
    if (rel.length) {
      items.push(el("li", null, "Nejvíc se náš elektorát překrývá s ", el("b", null, rel[0].v.label), ` (${r2(rel[0].r)}, ${korelSlovy(rel[0].r)}).`));
      const last = rel[rel.length - 1];
      items.push(el("li", null, "Nejodlišnější elektorát má ", el("b", null, last.v.label), ` (${r2(last.r)}).`));
    }
    const u = A.M[ours][P.length - 1];
    if (u != null) items.push(el("li", null, `S účastí: ${r2(u)} — ` + (u > 0.15 ? "jsme silnější tam, kde se chodí víc volit." : u < -0.15 ? "jsme silnější v okrscích s nižší účastí." : "bez výrazného vztahu.")));
    const oursD = Pd.findIndex(v => v.s && v.s.ours);
    if (oursD >= 0) {
      const relD = Pd.map((v, k) => ({ v, r: B.M[oursD][k] })).filter(x => x.r != null && x.v.s).sort((a, b) => a.r - b.r);
      if (relD.length && relD[0].r < -0.1) items.push(el("li", null, "Změny: kde jsme rostli, nejvíc ztrácel(a) ", el("b", null, relD[0].v.label), ` (${r2(relD[0].r)}) — možný přesun voličů.`));
    }
    sec.append(el("div", { class: "text", style: "margin-top:14px" }, el("ul", null, items)));
  }
  sec.append(el("p", { class: "note" },
    "Pozor: korelace mezi okrsky neříká nic o chování jednotlivých voličů (ekologická chyba). Podíly se navíc sčítají do 100 %, takže mírně záporné korelace vznikají i mechanicky."));
  sec.append(scatterBox);
}

function scatter(V, a, b, getter, w, r, box, title) {
  const ok = V.ok;
  const xs = getter(a), ys = getter(b);
  const pts = V.idx.filter(i => w[i] > 0 && isFinite(xs[i]) && isFinite(ys[i])).map(i => ({ i, x: xs[i], y: ys[i] }));
  const W = 760, H = 420, m = { l: 48, r: 16, t: 16, b: 40 };
  const ext = arr => { let lo = Math.min(...arr), hi = Math.max(...arr); if (lo === hi) { lo -= 1; hi += 1; } const p = (hi - lo) * 0.05; return [lo - p, hi + p]; };
  const [x0, x1] = ext(pts.map(p => p.x)), [y0, y1] = ext(pts.map(p => p.y));
  const X = v => m.l + (v - x0) / (x1 - x0) * (W - m.l - m.r), Y = v => H - m.b - (v - y0) / (y1 - y0) * (H - m.t - m.b);
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Bodový graf ${a.label} a ${b.label}`);
  const add = (tag, at, txt) => { const e = document.createElementNS(NS, tag); for (const k in at) e.setAttribute(k, at[k]); if (txt != null) e.textContent = txt; svg.append(e); return e; };
  const ticks = (lo, hi) => { const st = niceStep((hi - lo) / 5); const out = []; for (let t = Math.ceil(lo / st) * st; t <= hi; t += st) out.push(+t.toFixed(6)); return out; };
  for (const t of ticks(x0, x1)) { add("line", { x1: X(t), x2: X(t), y1: m.t, y2: H - m.b, class: "ax" }); add("text", { x: X(t), y: H - m.b + 16, "text-anchor": "middle" }, NF1.format(t)); }
  for (const t of ticks(y0, y1)) { add("line", { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), class: "ax" }); add("text", { x: m.l - 6, y: Y(t) + 4, "text-anchor": "end" }, NF1.format(t)); }
  const suffix = title.startsWith("Změny") ? " (změna, p. b.)" : " (%)";
  add("text", { x: W - m.r, y: H - 6, "text-anchor": "end" }, a.label + suffix);
  add("text", { x: m.l, y: 11 }, b.label + suffix);
  const col = (b.s && b.s.ours) || (a.s && a.s.ours) ? GREEN : "#2a78d6";
  const dots = pts.map(p => add("circle", { cx: X(p.x), cy: Y(p.y), r: 4.5, fill: col, class: "pt", "fill-opacity": 0.85 }));
  let hl = null;
  svg.addEventListener("pointermove", ev => {
    const rect = svg.getBoundingClientRect(), sx = W / rect.width;
    const mx = (ev.clientX - rect.left) * sx, my = (ev.clientY - rect.top) * sx;
    let best = -1, bd = 1e9;
    pts.forEach((p, k) => { const d = (X(p.x) - mx) ** 2 + (Y(p.y) - my) ** 2; if (d < bd) { bd = d; best = k; } });
    if (best < 0 || bd > (24 * sx) ** 2) { tip.hide(); if (hl) hl.classList.remove("hl"); return; }
    if (hl) hl.classList.remove("hl");
    hl = dots[best]; hl.classList.add("hl");
    const p = pts[best];
    tip.show(ev, el("div", null, el("b", null, okrsekLabel(V, p.i))),
      el("div", { class: "m" }, `${a.label}: ${NF2.format(p.x)} · ${b.label}: ${NF2.format(p.y)}`),
      el("div", { class: "m" }, `${int(ok.volici[p.i])} voličů`));
  });
  svg.addEventListener("pointerleave", () => { tip.hide(); if (hl) hl.classList.remove("hl"); });
  box.replaceChildren(el("h3", { style: "margin:18px 0 4px" }, `${title}: ${a.label} × ${b.label} — r = ${r2(r)} (${korelSlovy(r)})`), svg);
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}

/* ---------------------------------------------- MČ vs. magistrát (2 lístky) */

function secDvaListky(V, sec) {
  const ok = V.ok;
  const Mz = S.celky[BRNO];
  const magNase = Mz.strany.find(s => s.por === Mz.nase);
  sec.append(el("p", { class: "lead" },
    `Ve stejné volební místnosti dostali voliči dva lístky. Porovnání podílu naší kandidátky do zastupitelstva MČ (${V.nase.zkratka}) s podílem ${magNase.zkratka} do zastupitelstva města ve stejných okrscích ukazuje, kde táhne místní kandidátka víc než celoměstská značka a naopak.`));
  const loc = V.idx.map(i => ok.platne[i] ? ok.hlasy[V.z.nase][i] / ok.platne[i] * 100 : NaN);
  const mag = V.idx.map(i => ok.mag_platne[i] ? ok.mag_nase[i] / ok.mag_platne[i] * 100 : NaN);
  const L = V.nase.p;
  const M = sum(ok.mag_nase, V.idx) / sum(ok.mag_platne, V.idx) * 100;
  sec.append(el("div", { class: "tiles" },
    el("div", { class: "tile ours" }, el("span", { class: "lbl" }, "Kandidátka do MČ"), el("span", { class: "val" }, NF2.format(L), el("small", null, "%"))),
    el("div", { class: "tile" }, el("span", { class: "lbl" }, `${magNase.zkratka} do města`), el("span", { class: "val" }, NF2.format(M), el("small", null, "%"))),
    el("div", { class: "tile" }, el("span", { class: "lbl" }, "Rozdíl"), el("span", { class: "val" }, pp(L - M)),
      el("span", { class: "d" }, L > M ? "místní kandidátka táhne víc" : "celoměstská značka táhne víc"))));
  const diff = new Map(V.idx.map((i, k) => [i, ok.zvlastni[i] ? null : loc[k] - mag[k]]));
  const sc = divScale([...diff.values()], 0);
  const mapEl = el("div", { class: "map" });
  const panel = el("div", { class: "side-panel" });
  const legend = scaleLegend(sc, v => (v > 0 ? "+" : v < 0 ? "−" : "") + NF1.format(Math.abs(v)), "Rozdíl MČ − město (p. b.)");
  sec.append(el("div", { class: "map-wrap" }, el("div", null, mapEl, legend), panel));
  const map = newMap(mapEl);
  okrskyLayer(map, V, V.idx, i => sc.color(diff.get(i)), i => {
    const k = V.idx.indexOf(i);
    return [el("div", null, el("b", null, pp(diff.get(i))), " MČ − město"), el("div", null, okrsekLabel(V, i)),
      el("div", { class: "m" }, `MČ ${pct(loc[k])} · město ${pct(mag[k])}`)];
  }, i => panel.replaceChildren(okrsekPanel(V, i)));
  const ranked = V.idx.filter(i => diff.get(i) != null).sort((a, b) => diff.get(b) - diff.get(a));
  const li = i => el("li", null, `${okrsekLabel(V, i)} — `, el("b", null, pp(diff.get(i))));
  panel.replaceChildren(el("div", null, el("h3", null, "Kde je rozdíl největší"),
    el("p", { style: "margin:8px 0 4px;font-weight:700" }, "Místní kandidátka silnější"), el("ol", { style: "margin:0;padding-left:20px" }, ranked.slice(0, 5).map(li)),
    el("p", { style: "margin:10px 0 4px;font-weight:700" }, "Celoměstská kandidátka silnější"), el("ol", { style: "margin:0;padding-left:20px" }, ranked.slice(-5).reverse().map(li))));
  setTimeout(() => map.invalidateSize(), 50);
  const r = wcorr(loc, mag, V.idx.map(i => ok.zvlastni[i] ? 0 : ok.platne[i]));
  sec.append(el("p", { class: "note" }, r == null
    ? "Korelaci obou výsledků nelze při malém počtu okrsků spočítat."
    : `Korelace výsledků obou kandidátek po okrscích: ${r2(r)} (${r > 0.6 ? "obě kandidátky jsou silné ve stejných místech" : r > 0.3 ? "částečně stejná místa" : "místní kandidátka oslovuje jinde než celoměstská"}).`));
}

/* ----------------------------------------------------------- interní */

function interniCelek(V) {
  return S.interni && S.interni.celky[V.z.kod];
}
function komentar(key, sekce, nadpis = "Komentář") {
  const k = S.interni && S.interni.komentare[key];
  const t = k && k[sekce];
  if (!t) return null;
  return el("div", { class: "komentar" }, el("h4", null, nadpis), mdText(t));
}
function mdText(t) {
  // Minimální Markdown: odstavce, odrážky „- “, **tučně**.
  const box = el("div", { class: "text" });
  let ul = null;
  for (const line of t.split("\n")) {
    const s = line.trim();
    if (!s) { ul = null; continue; }
    const parts = s.replace(/^[-*] /, "").split(/\*\*(.+?)\*\*/g).map((p, k) => k % 2 ? el("b", null, p) : p);
    if (/^[-*] /.test(s)) { if (!ul) { ul = el("ul"); box.append(ul); } ul.append(el("li", null, parts)); }
    else { ul = null; box.append(el("p", null, parts)); }
  }
  return box;
}
function viewKey(V) { return V.route.kind === "magmc" ? `mag:${V.route.mc}` : V.z.kod; }

const TYPY = {
  "bašta": "Bašta — náš podíl ≥ 125 % průměru a účast nadprůměrná. Udržet, čerpat dobrovolníky.",
  "mobilizace": "Mobilizace — silný podíl, ale podprůměrná účast. Naši voliči tu jsou, jen nechodí: kampaň „přijď volit“, door-to-door.",
  "přesvědčování": "Přesvědčování — u nás podprůměr, ale nadprůměrně silné blízké strany (Piráti). Voliči otevření našim tématům.",
  "ztráta": "Ztráta — pokles o 2 a více p. b. proti 2022. Zjistit proč (lokální téma, kandidát, konkurence).",
  "nadprůměr": "Nadprůměr — podíl nad průměrem, bez zvláštní příležitosti.",
  "slabé místo": "Slabé místo — podprůměr a málo blízkých voličů. Nízká priorita.",
  "podezřelý zápis": "Podezřelý zápis — naše kandidátka zde má podle úředních dat 0 hlasů; pravděpodobně chyba v zápisu komise. Nevyhodnocuje se.",
  "zvláštní okrsek": "Zvláštní okrsek — voliči s evidenční adresou na úřadě; nevyhodnocuje se.",
};

function secCoDelat(V, sec) {
  const I = interniCelek(V);
  const Ib = S.interni.celky[BRNO];
  const key = viewKey(V);
  const kom = komentar(key, "co-delat");
  if (kom) sec.append(kom);
  const anom = komentar(key, "anomalie", "Podezřelé zápisy okrskových komisí");
  if (anom) sec.append(anom);
  const src = V.route.kind === "magmc" ? Ib : I;
  if (!src) { sec.append(el("p", { class: "note" }, "Interní data pro tento celek chybí.")); return; }
  const auto = [];
  if (V.full) {
    const m = src.mandat;
    const tiles = el("div", { class: "tiles" },
      m.chybi_do_dalsiho != null && el("div", { class: "tile" }, el("span", { class: "lbl" }, `Do ${m.mandatu + 1}. mandátu chybělo`),
        el("span", { class: "val" }, int(m.chybi_do_dalsiho_volici)), el("span", { class: "d" }, `voličů celé kandidátky (${int(m.chybi_do_dalsiho)} křížků)`)),
      m.rezerva != null && el("div", { class: "tile" }, el("span", { class: "lbl" }, `Rezerva ${m.mandatu}. mandátu`),
        el("span", { class: "val" }, int(m.rezerva_volici)), el("span", { class: "d" }, `voličů (${int(m.rezerva)} křížků)`)),
      m.chybi_do_5 != null && el("div", { class: "tile" }, el("span", { class: "lbl" }, "Do 5% hranice chybělo"),
        el("span", { class: "val" }, int(m.chybi_do_5_volici)), el("span", { class: "d" }, `voličů (${int(m.chybi_do_5)} křížků)`)),
      el("div", { class: "tile" }, el("span", { class: "lbl" }, "Odhad našich voličů"), el("span", { class: "val" }, int(m.volicu_odhad)),
        el("span", { class: "d" }, `${NF1.format(m.krizku_na_obalku)} křížku na obálku`)));
    sec.append(tiles);
    if (m.chybi_do_dalsiho != null) auto.push(`Další mandát by přinesl zisk zhruba ${int(m.chybi_do_dalsiho_volici)} voličů hlasujících celou kandidátku (při jinak stejných výsledcích ostatních).`);
    if (m.rezerva != null) auto.push(m.rezerva_volici < 300 ? `Pozor: poslední mandát byl těsný — stačilo by o ${int(m.rezerva_volici)} voličů méně a byl by ztracen.` : `Rezerva posledního mandátu je ${int(m.rezerva_volici)} voličů.`);
  }
  // Magistrát: MČ pod průměrem Brna
  if (V.route.kind === "mag" && src.mc) {
    const pod = src.mc.filter(m => m.do_prumeru_volici > 0);
    const celkem = pod.reduce((a, m) => a + m.do_prumeru_volici, 0);
    auto.push(`Kdyby všechny městské části dosáhly alespoň brněnského průměru (${pct(src.parametry.prumer_pct, 2)}), získali bychom asi ${int(celkem)} voličů navíc — nejvíc v MČ ${pod.slice(0, 3).map(m => m.nazev).join(", ")}.`);
    sec.append(el("h3", { style: "margin:16px 0 6px" }, "Městské části pod průměrem Brna"));
    sec.append(table([
      { key: "nazev", label: "MČ" },
      { key: "volici", label: "Voličů", num: true, fmt: int },
      { key: "ucast", label: "Účast", num: true, fmt: v => pct(v) },
      { key: "pct", label: "Náš podíl", num: true, fmt: v => pct(v, 2) },
      { key: "pct22", label: "2022", num: true, fmt: v => pct(v, 2) },
      { key: "index", label: "Index", num: true },
      { key: "do_prumeru_volici", label: "Voličů do průměru", num: true, fmt: int },
    ], src.mc.filter(m => m.do_prumeru_volici > 0), { sortKey: "do_prumeru_volici", onRow: r => { location.hash = `#/mag/${r.kod}`; } }));
  }
  if (V.route.kind === "magmc" && Ib) {
    const r = Ib.mc.find(m => m.kod === V.route.mc);
    if (r) {
      sec.append(el("div", { class: "tiles" },
        el("div", { class: "tile" }, el("span", { class: "lbl" }, "Index vůči Brnu"), el("span", { class: "val" }, String(r.index)), el("span", { class: "d" }, "100 = brněnský průměr")),
        el("div", { class: "tile" }, el("span", { class: "lbl" }, "Naši voliči (odhad)"), el("span", { class: "val" }, int(r.nase_volici_odhad))),
        el("div", { class: "tile" }, el("span", { class: "lbl" }, "Voličů do průměru Brna"), el("span", { class: "val" }, int(r.do_prumeru_volici)))));
      auto.push(r.index >= 100
        ? `MČ ${r.nazev} je pro nás nadprůměrná (index ${r.index}). Prioritou je udržet a mobilizovat.`
        : `V MČ ${r.nazev} máme ${r.index} % brněnského průměru; k dorovnání by bylo třeba asi ${int(r.do_prumeru_volici)} voličů navíc.`);
    }
  }
  // Priority okrsků
  const pr = src.priority.filter(p => V.idx.includes(V.ok.id.indexOf(p.id)));
  const counts = {};
  for (const p of pr) counts[p.typ] = (counts[p.typ] || 0) + 1;
  const sumPot = pr.reduce((a, p) => a + p.potencial, 0);
  const top = pr.slice(0, 10);
  if (top.length) {
    const potTop = top.reduce((a, p) => a + p.potencial, 0);
    auto.push(`Deset prioritních okrsků nabízí odhadem ${int(potTop)} voličů (${int(potTop / Math.max(1, sumPot) * 100)} % potenciálu celého území) — doporučené cíle pro kontaktní kampaň.`);
  }
  if (counts["mobilizace"]) auto.push(`${counts["mobilizace"]} okrsků typu „mobilizace“: máme tam silnou podporu, ale nízkou účast — klíčové pro kampaň „přijď volit“.`);
  if (counts["ztráta"]) auto.push(`${counts["ztráta"]} okrsků, kde jsme proti 2022 ztratili 2 a více p. b. — stojí za kvalitativní rozbor.`);
  sec.append(el("h3", { style: "margin:16px 0 6px" }, "Shrnutí"), el("div", { class: "text" }, el("ul", null, auto.map(t => el("li", null, t)))));

  sec.append(el("h3", { style: "margin:16px 0 6px" }, "Typologie okrsků"));
  const P = src.parametry;
  sec.append(el("p", { class: "note", style: "margin:0 0 10px" },
    `Průměrný podíl ${pct(P.prumer_pct, 2)}, 75. percentil ${pct(P.p75_pct, 2)}, medián účasti ${pct(P.median_ucast)}; blízké strany: ${P.blizke.join(", ") || "–"}.`));
  const chips = el("div", { class: "typ-chips" });
  const mapEl = el("div", { class: "map" });
  const panel = el("div", { class: "side-panel" });
  sec.append(chips, el("div", { class: "map-wrap" }, mapEl, panel));
  const map = newMap(mapEl);
  const prById = new Map(pr.map(p => [p.id, p]));
  let active = Object.keys(TYPY).find(t => counts[t] && t === "mobilizace") || Object.keys(counts)[0];
  const colorOf = i => { const p = prById.get(V.ok.id[i]); return p && p.typ === active ? GREEN : MID[S.theme]; };
  const layer = okrskyLayer(map, V, V.idx, colorOf, i => {
    const p = prById.get(V.ok.id[i]);
    return [el("div", null, el("b", null, p ? p.typ : "–")), el("div", null, okrsekLabel(V, i)),
      p && el("div", { class: "m" }, `podíl ${pct(p.pct)} · účast ${pct(p.ucast)} · potenciál ${int(p.potencial)} voličů (${p.poradi}. místo)`)];
  }, i => panel.replaceChildren(okrsekPanel(V, i)), { opacity: 0.75 });
  function drawChips() {
    chips.replaceChildren(...Object.keys(TYPY).filter(t => counts[t]).map(t => {
      const b = el("button", { type: "button", class: t === active ? "on" : null }, `${t} (${counts[t]})`);
      b.addEventListener("click", () => { active = t; drawChips(); layer.recolor(colorOf); });
      return b;
    }));
    panel.replaceChildren(el("div", null, el("h3", null, active), el("p", null, TYPY[active]),
      el("ol", { style: "margin:0;padding-left:20px" }, pr.filter(p => p.typ === active).slice(0, 12).map(p => {
        const i = V.ok.id.indexOf(p.id);
        return el("li", null, `${okrsekLabel(V, i)} — `, el("b", null, pct(p.pct)), el("span", { class: "muted" }, ` · účast ${pct(p.ucast)}`));
      }))));
  }
  drawChips();
  setTimeout(() => map.invalidateSize(), 50);

  sec.append(el("h3", { style: "margin:18px 0 6px" }, "Prioritní okrsky"));
  sec.append(el("p", { class: "note", style: "margin:0 0 8px" },
    "Potenciál (ve voličích) = přesvědčování (dorovnání podílu na 75. percentil okrsků při současné účasti, vážené podílem blízkých stran vůči průměru) + mobilizace (dorovnání účasti na medián při našem současném podílu). Je to orientační měřítko pro výběr cílů, ne předpověď."));
  sec.append(table([
    { key: "poradi", label: "#", num: true },
    { key: "nazev", label: "Okrsek", sortVal: r => r.nazev, cell: r => [r.nazev, el("span", { class: "small" }, r.ulice)] },
    { key: "typ", label: "Typ" },
    { key: "volici", label: "Voličů", num: true, fmt: int },
    { key: "ucast", label: "Účast", num: true, fmt: v => pct(v) },
    { key: "pct", label: "Náš podíl", num: true, fmt: v => pct(v, 2) },
    { key: "zmena", label: "Změna", num: true, fmt: v => pp(v) },
    { key: "blizke", label: "Blízké strany", num: true, fmt: v => pct(v) },
    { key: "pot_presvedceni", label: "Přesvědč.", num: true, fmt: int },
    { key: "pot_mobilizace", label: "Mobiliz.", num: true, fmt: int },
    { key: "potencial", label: "Potenciál", num: true, fmt: int },
  ], pr.slice(0, 40).map(p => {
    const i = V.ok.id.indexOf(p.id);
    return { ...p, nazev: okrsekLabel(V, i), ulice: V.ok.ulice[i] };
  }), { sortKey: "potencial" }));
}

function secKonkurence(V, sec) {
  const kom = komentar(viewKey(V), "konkurence");
  if (kom) sec.append(kom);
  const ok = V.ok;
  const inIdx = V.idx.filter(i => !ok.zvlastni[i]);
  const w = ok.id.map((_, i) => inIdx.includes(i) ? ok.platne[i] : 0);
  const wz = ok.id.map((_, i) => inIdx.includes(i) && ok.spolehlive[i] ? ok.platne[i] : 0);
  const share = por => ok.id.map((_, i) => ok.platne[i] ? ok.hlasy[por][i] / ok.platne[i] * 100 : NaN);
  const share22 = por => ok.hlasy22[por] ? ok.id.map((_, i) => ok.platne22[i] ? ok.hlasy22[por][i] / ok.platne22[i] * 100 : NaN) : null;
  const nase = V.nase, nX = share(nase.por), n22 = share22(nase.por);
  const nD = n22 ? nX.map((v, i) => v - n22[i]) : null;
  const konk = V.strany.filter(s => !s.ours && (s.p >= 5 || ["pirati", "luzanky"].includes(s.skupina)));
  sec.append(el("p", { class: "lead" },
    "Kandidátky nad 5 % a vždy Piráti a Za Lužánky. Překryv = korelace podílů po okrscích s naší kandidátkou; korelace změn ukazuje, zda strana rostla tam, kde jsme ztráceli (a naopak)."));
  const cards = el("div", { class: "cards" });
  for (const s of konk) {
    const x = share(s.por), x22 = share22(s.por);
    const r = inIdx.length >= MIN_KOREL ? wcorr(x, nX, w) : null;
    const d = x22 ? x.map((v, i) => v - x22[i]) : null;
    const rd = d && nD && inIdx.length >= MIN_KOREL ? wcorr(d, nD, wz) : null;
    const silne = [...inIdx].sort((a, b) => x[b] - x[a]).slice(0, 4);
    const oni = d && nD ? inIdx.filter(i => ok.spolehlive[i] && d[i] > 0 && nD[i] < 0).sort((a, b) => (d[b] - nD[b]) - (d[a] - nD[a])).slice(0, 3) : [];
    const veta = [];
    if (r != null) veta.push(r >= 0.25 ? `Sdílí s námi voliče (${r2(r)}): jsou silní tam, kde my — přímý konkurent o stejný elektorát.`
      : r <= -0.25 ? `Má jiný elektorát (${r2(r)}): jejich bašty jsou naše slabá místa — přímý střet o voliče je malý.`
        : `Vztah k našim výsledkům je slabý (${r2(r)}).`);
    if (rd != null && rd <= -0.15) veta.push(`Kde rostli, my jsme spíš ztráceli (${r2(rd)}) — pravděpodobně od nás přetáhli část voličů.`);
    else if (rd != null && rd >= 0.15) veta.push(`Rostli a klesali jsme spolu (${r2(rd)}) — spíš společný trend (mobilizace, téma) než přetahování.`);
    if (s.d != null) veta.push(`Proti 2022 ${s.d >= 0 ? "posílili" : "oslabili"} o ${NF1.format(Math.abs(s.d))} p. b.`);
    else veta.push("Kandidovali poprvé (bez srovnatelného předchůdce).");
    let mcTop = null;
    if (V.route.kind === "mag") {
      mcTop = V.z.mc.map(m => ({ n: m.nazev, p: m.hlasy[s.por] / m.platne * 100 })).sort((a, b) => b.p - a.p).slice(0, 4);
    }
    cards.append(el("div", { class: "kcard", style: `border-left-color:${s.color}` },
      el("h3", null, s.zkratka),
      el("div", { class: "row" },
        el("span", null, el("b", null, pct(s.p, 2)), " ", el("span", { class: "dlt " + dltClass(s.d) }, s.d == null ? "nová" : pp(s.d))),
        V.full && el("span", null, el("b", null, String(s.mandaty)), " mand." + (s.mandaty22 != null ? ` (2022: ${s.mandaty22})` : "")),
        el("span", null, "překryv ", el("b", null, r == null ? "–" : r2(r)))),
      el("p", null, veta.join(" ")),
      el("p", null, el("b", null, "Nejsilnější okrsky: "), silne.map(i => `${okrsekLabel(V, i)} (${pct(x[i])})`).join("; ")),
      mcTop && el("p", null, el("b", null, "Nejsilnější MČ: "), mcTop.map(m => `${m.n} ${pct(m.p)}`).join(", ")),
      oni.length > 0 && el("p", null, el("b", null, "Rostli, kde jsme ztratili: "), oni.map(i => `${okrsekLabel(V, i)} (oni ${pp(d[i])}, my ${pp(nD[i])})`).join("; ")),
      s.pozn && el("p", { class: "note" }, s.pozn)));
  }
  sec.append(cards);
  if (!konk.length) sec.append(el("p", { class: "note" }, "V tomto celku nekandiduje žádná sledovaná konkurence."));
}

init();
