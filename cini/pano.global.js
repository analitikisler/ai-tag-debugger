// Çini · Mercan kit, built 2026-11-11 from analitikisler 97701e7 (styles/tokens.json). Do not edit: rebuild with cini-kit/build.ts.
(() => {
  var __defProp = Object.defineProperty;
  var __returnValue = (v) => v;
  function __exportSetter(name, newValue) {
    this[name] = __returnValue.bind(null, newValue);
  }
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, {
        get: all[name],
        enumerable: true,
        configurable: true,
        set: __exportSetter.bind(all, name)
      });
  };

  // ../../analitikisler/lib/pattern/index.ts
  var exports_pattern = {};
  __export(exports_pattern, {
    HATCH_ID: () => HATCH_ID,
    ROLES: () => ROLES,
    band: () => band,
    field: () => field,
    hatchMask: () => hatchMask,
    hatchPattern: () => hatchPattern,
    panel: () => panel
  });

  // ../../analitikisler/lib/pattern/pano.ts
  var model = (() => {
    const hash = (s) => {
      let h = 2166136261;
      for (const ch of String(s)) {
        h ^= ch.codePointAt(0);
        h = Math.imul(h, 16777619);
      }
      return h >>> 0;
    };
    const rng = (seed) => {
      let x = hash(String(seed)) || 1;
      return () => {
        x ^= x << 13;
        x >>>= 0;
        x ^= x >>> 17;
        x ^= x << 5;
        x >>>= 0;
        return x / 4294967296;
      };
    };
    const n = (v) => {
      const r = Math.round(v * 10) / 10;
      return Object.is(r, -0) ? "0" : String(r);
    };
    const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    const C = (o) => ({ ground: o.ground || "var(--tile)", line: o.line || "var(--tile-line)", accent: o.accent || "var(--tile-accent)", point: o.point || "var(--point)" });
    const wrap = (W, H, inner, o = {}) => `<svg xmlns="http://www.w3.org/2000/svg" class="${esc(o.cls || "pat")}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="${o.align || "xMidYMid"} ${o.slice === false ? "meet" : "slice"}" ${o.label ? `role="img" aria-label="${esc(o.label)}"` : 'aria-hidden="true"'}>${inner}</svg>`;
    const dot = (x, y, r, c) => `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r + 2)}" fill="${c.line}"/><circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="${c.point}"/>`;
    function through(P, t0, t1) {
      let d = "";
      for (let i = 0;i < P.length - 1; i++) {
        const a = P[i], b = P[i + 1];
        const ta = i === 0 && t0 ? t0 : [(b[0] - (P[i - 1] || a)[0]) / 2, (b[1] - (P[i - 1] || a)[1]) / 2];
        const tb = i === P.length - 2 && t1 ? t1 : [((P[i + 2] || b)[0] - a[0]) / 2, ((P[i + 2] || b)[1] - a[1]) / 2];
        d += `C${n(a[0] + ta[0] / 3)} ${n(a[1] + ta[1] / 3)} ${n(b[0] - tb[0] / 3)} ${n(b[1] - tb[1] / 3)} ${n(b[0])} ${n(b[1])}`;
      }
      return d;
    }
    function herm(P, k = 1) {
      let d = "";
      for (let i = 0;i < P.length - 1; i++) {
        const a = P[i], b = P[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) * k / 3;
        const la = Math.hypot(a[2], a[3]) || 1, lb = Math.hypot(b[2], b[3]) || 1;
        d += `C${n(a[0] + a[2] / la * L)} ${n(a[1] + a[3] / la * L)} ${n(b[0] - b[2] / lb * L)} ${n(b[1] - b[3] / lb * L)} ${n(b[0])} ${n(b[1])}`;
      }
      return d;
    }
    function rel(d) {
      const T = d.match(/[MLHVCSQAZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) || [];
      let i = 0, x = 0, y = 0, sx = 0, sy = 0, out = "", last = "";
      const q = (v) => Math.round(v * 10) / 10, f = (v) => {
        const r = q(v);
        return (Object.is(r, -0) ? "0" : String(r)).replace(/^(-?)0\./, "$1.");
      };
      const join = (a) => a.map(f).reduce((s, t) => s + (s && t[0] !== "-" && !(t[0] === "." && /\.\d*$/.test(s)) ? " " : "") + t, "");
      const num = () => parseFloat(T[i++]);
      const to = (X, Y) => {
        const dx = q(X - x), dy = q(Y - y);
        x = q(x + dx);
        y = q(y + dy);
        return [dx, dy];
      };
      while (i < T.length) {
        const c = T[i++];
        let k, a;
        if (c === "Z" || c === "z") {
          out += "z";
          x = sx;
          y = sy;
          last = "z";
          continue;
        }
        if (c === "M") {
          const X = num(), Y = num();
          if (!out) {
            x = sx = q(X);
            y = sy = q(Y);
            out = "M" + join([X, Y]);
            last = "M";
            continue;
          }
          a = to(X, Y);
          sx = x;
          sy = y;
          k = "m";
        } else if (c === "L") {
          a = to(num(), num());
          k = "l";
        } else if (c === "H") {
          a = [to(num(), y)[0]];
          k = "h";
        } else if (c === "V") {
          a = [to(x, num())[1]];
          k = "v";
        } else if (c === "C") {
          const v = [num(), num(), num(), num(), num(), num()], x0 = x, y0 = y;
          a = [v[0] - x0, v[1] - y0, v[2] - x0, v[3] - y0, ...to(v[4], v[5])];
          k = "c";
        } else if (c === "S" || c === "Q") {
          const v = [num(), num(), num(), num()], x0 = x, y0 = y;
          a = [v[0] - x0, v[1] - y0, ...to(v[2], v[3])];
          k = c.toLowerCase();
        } else if (c === "A") {
          const v = [num(), num(), num(), num(), num(), num(), num()];
          a = [v[0], v[1], v[2], v[3], v[4], ...to(v[5], v[6])];
          k = "a";
        } else
          continue;
        const body = join(a);
        out += (k === last && k !== "m" ? body[0] === "-" || body[0] === "." && /\.\d*$/.test(out) ? "" : " " : k) + body;
        last = k;
      }
      return out;
    }
    function frame(cols, rows, U, fw, c, fieldInner, bandInner, cornerInner, seed) {
      const W = cols * U, H = rows * U, f = fw / 2 + U * 0.03, fc = cols - 2, fr = rows - 2;
      const band = (len, tf, k) => `<g transform="${tf}"><svg width="${len * U}" height="${U}" viewBox="0 0 ${len * U} ${U}">${bandInner(len, `${seed}-b${k}`)}</svg></g>`;
      const corner = (tf) => `<g transform="${tf}"><svg width="${U}" height="${U}" viewBox="0 0 ${U} ${U}">${cornerInner()}</svg></g>`;
      let s = `<rect width="${W}" height="${H}" fill="${c.ground}"/>`;
      s += `<svg x="${U}" y="${U}" width="${fc * U}" height="${fr * U}" viewBox="0 0 ${fc * U} ${fr * U}">${fieldInner(fc, fr)}</svg>`;
      s += band(fc, `translate(${U} 0)`, "t") + band(fc, `translate(${W - U} ${H}) rotate(180)`, "b");
      s += band(fr, `translate(0 ${H - U}) rotate(-90)`, "l") + band(fr, `translate(${W} ${U}) rotate(90)`, "r");
      s += corner("translate(0 0)") + corner(`translate(${W} 0) rotate(90)`) + corner(`translate(${W} ${H}) rotate(180)`) + corner(`translate(0 ${H}) rotate(-90)`);
      const g = `fill="none" stroke="${c.line}" stroke-width="${fw}"`;
      s += `<rect x="${n(f)}" y="${n(f)}" width="${n(W - 2 * f)}" height="${n(H - 2 * f)}" ${g}/><rect x="${n(U - f)}" y="${n(U - f)}" width="${n(W - 2 * U + 2 * f)}" height="${n(H - 2 * U + 2 * f)}" ${g}/>`;
      s += `<path d="M${n(U - f)} ${n(f)}V${n(U - f)}H${n(f)}M${n(W - U + f)} ${n(f)}V${n(U - f)}H${n(W - f)}M${n(U - f)} ${n(H - f)}V${n(H - U + f)}H${n(f)}M${n(W - U + f)} ${n(H - f)}V${n(H - U + f)}H${n(W - f)}" ${g}/>`;
      return { W, H, s };
    }
    const U = 32, SW = 2.4, RW = 4.2;
    const S0 = "M0 0C0 18 32 14 32 32", S1 = "M32 0C32 18 0 14 0 32";
    const lens = (x, y, dx, dy, w) => {
      const ex = x + dx, ey = y + dy, mx = (x + ex) / 2, my = (y + ey) / 2, nx = -dy / Math.hypot(dx, dy) * w, ny = dx / Math.hypot(dx, dy) * w;
      return `M${n(x)} ${n(y)}Q${n(mx + nx)} ${n(my + ny)} ${n(ex)} ${n(ey)}Q${n(mx - nx)} ${n(my - ny)} ${n(x)} ${n(y)}Z`;
    };
    const cross = (x, y, l = 10.5, w = 4.6, g = 2.4) => lens(x, y - g, 0, -l, w) + lens(x + g, y, l, 0, w) + lens(x, y + g, 0, l, w) + lens(x - g, y, -l, 0, w);
    const rosette = (x, y, R, sag) => {
      const P = (k) => [x + R * Math.cos(k * Math.PI / 4), y + R * Math.sin(k * Math.PI / 4)], ch = 2 * R * Math.sin(Math.PI / 8), rr = (ch * ch / 4 + sag * sag) / (2 * sag);
      let d = `M${n(P(0)[0])} ${n(P(0)[1])}`;
      for (let k = 1;k <= 8; k++) {
        const p = P(k % 8);
        d += `A${n(rr)} ${n(rr)} 0 0 1 ${n(p[0])} ${n(p[1])}`;
      }
      return d + "Z";
    };
    function body(cols, rows, seed, o, c) {
      const r = rng(seed), W = cols * U, H = rows * U;
      const hi = new Set;
      let end = null;
      if (o.trace !== false && rows >= 3 && cols > 1) {
        let j = Math.min(Math.max(o.startRow != null ? o.startRow + 1 : Math.floor(rows / 2), 1), rows - 1);
        if (j % 2)
          j = j + 1 <= rows - 1 ? j + 1 : j - 1;
        const last = cols - 1, jEnd = o.endRow != null ? o.endRow + 1 : null;
        for (let x = 0;x < last; x++) {
          const left = last - x - 1;
          let m = r() < 0.5 ? -1 : 1;
          const ok = (k) => j + k >= 1 && j + k <= rows - 1 && (jEnd == null || Math.abs(j + k - jEnd) <= left + 1);
          if (!ok(m))
            m = -m;
          if (!ok(m))
            m = j <= 1 ? 1 : -1;
          hi.add(m > 0 ? `${x},${j}` : `${x},${j - 1}`);
          j += m;
        }
        end = { x: last * U, y: j * U };
      }
      let base = "", acc = "";
      for (let y = 0;y < rows; y++)
        for (let x = 0;x < cols; x++) {
          const p = `<path transform="translate(${x * U} ${y * U})" d="${(x + y) % 2 ? S1 : S0}"/>`;
          if (hi.has(`${x},${y}`))
            acc += p;
          else
            base += p;
        }
      let mot = "", cut = "", rings = "";
      for (let y = 0;y <= rows; y++)
        for (let x = 0;x <= cols; x++) {
          const X = x * U, Y = y * U;
          if ((x + y) % 2) {
            if (y % 2) {
              mot += rosette(X, Y, 7.4, 2.1);
              cut += `M${n(X + 2.6)} ${n(Y)}A2.6 2.6 0 1 1 ${n(X - 2.6)} ${n(Y)}A2.6 2.6 0 1 1 ${n(X + 2.6)} ${n(Y)}Z`;
            } else
              mot += cross(X, Y);
          } else if (!(end && X === end.x && Y === end.y))
            rings += `M${n(X + 3.6)} ${n(Y)}A3.6 3.6 0 1 1 ${n(X - 3.6)} ${n(Y)}A3.6 3.6 0 1 1 ${n(X + 3.6)} ${n(Y)}Z`;
        }
      return `${c.ground !== "none" ? `<rect width="${W}" height="${H}" fill="${c.ground}"/>` : ""}<g fill="none" stroke="${c.line}" stroke-width="${SW}">${base}</g><path d="${mot}" fill="${c.line}"/><path d="${cut}" fill="${c.ground}"/>` + `<g fill="none" stroke="${c.accent}" stroke-width="${RW}" stroke-linecap="round">${acc}</g><path d="${rings}" fill="${c.ground}" stroke="${c.line}" stroke-width="2.2"/>${end ? dot(end.x, end.y, 5, c) : ""}`;
    }
    const GA = "M0 6.5C6.4 6.5 9.6 25.5 16 25.5S25.6 6.5 32 6.5", GB = "M0 25.5C6.4 25.5 9.6 6.5 16 6.5S25.6 25.5 32 25.5";
    const LOZ = (x) => `M${x} 9.6Q${x + 4.4} 16 ${x} 22.4Q${x - 4.4} 16 ${x} 9.6Z`;
    function bandBody(len, seed, c, edges = true) {
      const W = len * U;
      let w = "", f = "", g = "";
      for (let i = 0;i < len; i++) {
        const X = i * U;
        w += `<path transform="translate(${X} 0)" d="${GA}"/><path transform="translate(${X} 0)" d="${GB}"/>`;
        f += rosette(X + 16, 16, 4.6, 1.3) + LOZ(X) + LOZ(X + 32);
        g += `M${X + 17.4} 16A1.4 1.4 0 1 1 ${X + 14.6} 16A1.4 1.4 0 1 1 ${X + 17.4} 16Z`;
      }
      return `<rect width="${W}" height="${U}" fill="${c.ground}"/><g fill="none" stroke="${c.line}" stroke-width="2.2">${w}</g><path d="${f}" fill="${c.line}"/><path d="${g}" fill="${c.ground}"/>` + (edges ? `<path d="M0 1H${W}M0 31H${W}" stroke="${c.line}" stroke-width="2"/>` : "");
    }
    const cornerBody = (c) => `<rect width="${U}" height="${U}" fill="${c.ground}"/><path d="${rosette(16, 16, 9.4, 2.2)}" fill="${c.line}"/><circle cx="16" cy="16" r="4.6" fill="${c.ground}"/><circle cx="16" cy="16" r="2.2" fill="${c.line}"/>`;
    return {
      id: "b6-pano",
      name: "Pano",
      tr: "Çini pano",
      designer: "B",
      meaning: "A framed whole: the lattice is the measurement plan, every oval a page with its own reading, and the route crosses it node by node to the one that counts.",
      source: "The layout of a late-16th-century İznik tile panel (ogival lattice, a red guard band, corner pieces); the lattice is one S-curve per unit and the motifs are geometric, with no flowers or inscriptions.",
      module: U,
      tile(o = {}) {
        const c = C(o);
        return wrap(U, U, `<rect width="${U}" height="${U}" fill="${c.ground}"/><path d="${S0}" fill="none" stroke="${c.line}" stroke-width="${SW}"/><path d="M3.6 0A3.6 3.6 0 0 1 0 3.6M32 28.4A3.6 3.6 0 0 0 28.4 32" fill="none" stroke="${c.line}" stroke-width="2.2"/>`, o);
      },
      field(o = {}) {
        const cols = o.cols || 10, rows = o.rows || 6;
        return wrap(cols * U, rows * U, body(cols, rows, o.seed || "analitikisler", o, C(o)), o);
      },
      border(o = {}) {
        const len = o.length || 10;
        return wrap(len * U, U, bandBody(len, (o.seed || "analitikisler") + "-band", C(o)), { slice: false, ...o });
      },
      pano(o = {}) {
        const c = C(o), cols = Math.max(o.cols || 12, 4), rows = Math.max(o.rows || 8, 4), seed = o.seed || "analitikisler";
        const fr = frame(cols, rows, U, 2, c, (fc, frw) => body(fc, frw, seed, o, c), (len, s) => bandBody(len, s, c, false), () => cornerBody(c), seed);
        return wrap(fr.W, fr.H, fr.s, { slice: false, ...o });
      }
    };
  })();
  var pano_default = model;

  // ../../analitikisler/lib/pattern/index.ts
  var ROLES = {
    ground: "var(--color-tile)",
    line: "var(--color-tile-line)",
    accent: "var(--color-tile-accent)",
    point: "var(--color-point)"
  };
  function field(o) {
    return pano_default.field({ ...ROLES, ...o });
  }
  function band(o) {
    return pano_default.border({ ...ROLES, ...o });
  }
  function panel(o) {
    return pano_default.pano({ ...ROLES, ...o });
  }
  var HATCH_ID = "hatch-missing";
  var hatchPattern = (id = HATCH_ID, ground = "var(--color-surface)", ink = "var(--color-data-missing)") => `<pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="${ground}"/><circle cx="4" cy="4" r="2.2" fill="none" stroke="${ink}" stroke-width="1.3"/></pattern>`;
  var hatchMask = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><circle cx="4" cy="4" r="2.2" fill="none" stroke="#000" stroke-width="1.3"/></svg>')}")`;

  // dist/_global.ts
  globalThis.Pano = exports_pattern;
})();
