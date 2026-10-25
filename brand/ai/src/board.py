#!/usr/bin/env python3
"""Writes design/13-ai-brand/board.html: every asset in assets/, light and dark, with the rules from BRAND.md."""
from pathlib import Path
D = Path(__file__).resolve().parent.parent
P = [('tag-debugger', 'ai tag debugger', 'Open source · MIT'), ('tagging-server', 'ai tagging server', 'Early development'),
     ('cloud', 'ai cloud', 'Early access'), ('visibility', 'ai visibility', 'Early access · Be the answer.'), ('analyst', 'ai analyst', 'Alpha')]
COL = [('Ink', '#17140F', '#F1ECE2'), ('Paper', '#F3F0E8', '#151310'), ('Point · red pen', '#C12D30', '#FA6B6D'), ('Pencil', '#6A645A', '#A39C8F')]

def img(path, alt, h=None, cls=''):
    style = f' style="height:{h}px"' if h else ''
    return f'<img src="{path}" alt="{alt}"{style} class="{cls}">'

def pair(light, dark, alt, h):
    return f'<div class="pair"><div class="tile">{img(light, alt + ", light", h)}</div><div class="tile ink">{img(dark, alt + ", dark", h)}</div></div>'

rows = []
for slug, name, status in P:
    a = f'assets/lockups/ai-{slug}'
    rows.append(f'''<section class="product">
  <header><h3>{name}</h3><span class="status">{status}</span></header>
  {pair(a + '-light.svg', a + '-dark.svg', name, 40)}
  <div class="row">
    {pair(a + '-stacked-light.svg', a + '-stacked-dark.svg', name + ' stacked', 72)}
    {pair(a + '-endorsed-light.svg', a + '-endorsed-dark.svg', name + ' endorsed', 52)}
  </div>
  <div class="icons">{"".join(img(f"assets/icons/ai-{slug}-{n}.svg", f"{name} app icon {n}", min(n, 96)) for n in (512, 64, 32))}
    {"".join(img(f"assets/icons/ai-{slug}-{n}-ink.svg", f"{name} app icon {n}, ink", min(n, 96)) for n in (512, 64, 32))}
    <span class="mono">{img(a + '-mono.svg', name + ' mono', 22)}</span></div>
</section>''')

colours = ''.join(f'<div class="sw"><span style="background:{l}"></span><span style="background:{d}"></span><b>{n}</b><code>{l} · {d}</code></div>' for n, l, d in COL)

html = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ai brand board</title>
<meta name="description" content="The ai tool family of Analitik İşler: mark, lockups, icons, favicons, master logo and colours, light and dark. Rules in BRAND.md.">
<style>
:root {{ --bg: #F3F0E8; --card: #FBF9F4; --ink: #17140F; --muted: #6A645A; --rule: #DDD7CB; --point: #C12D30; color-scheme: light; }}
@media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{ --bg: #151310; --card: #1C1A16; --ink: #F1ECE2; --muted: #A39C8F; --rule: #35312A; --point: #FA6B6D; color-scheme: dark; }} }}
:root[data-theme="dark"] {{ --bg: #151310; --card: #1C1A16; --ink: #F1ECE2; --muted: #A39C8F; --rule: #35312A; --point: #FA6B6D; color-scheme: dark; }}
* {{ box-sizing: border-box; }}
body {{ margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }}
main {{ max-width: 1120px; margin: 0 auto; padding: 48px 16px 96px; }}
h1 {{ margin: 0 0 8px; font-size: clamp(28px, 4vw, 40px); letter-spacing: -0.02em; }}
h2 {{ margin: 64px 0 8px; font-size: 22px; }}
h3 {{ margin: 0; font-size: 17px; font-weight: 600; }}
p {{ max-width: 46em; color: var(--muted); }}
code {{ font: 13px/1.4 ui-monospace, "SF Mono", Menlo, monospace; }}
.lead b {{ color: var(--ink); }}
.pair {{ display: grid; grid-template-columns: 1fr 1fr; gap: 0; border: 1px solid var(--rule); border-radius: 10px; overflow: hidden; }}
.tile {{ display: grid; place-items: center; min-height: 120px; padding: 24px; background: #F3F0E8; }}
.tile.ink {{ background: #151310; }}
.tile img {{ max-width: 100%; }}
.product {{ margin-top: 28px; padding: 20px; border: 1px solid var(--rule); border-radius: 12px; background: var(--card); }}
.product header {{ display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 14px; }}
.status {{ color: var(--muted); font-size: 14px; }}
.row {{ display: grid; gap: 14px; margin-top: 14px; }}
@media (min-width: 760px) {{ .row {{ grid-template-columns: 1fr 1fr; }} }}
.icons {{ display: flex; flex-wrap: wrap; align-items: end; gap: 14px; margin-top: 16px; }}
.icons img {{ border-radius: 6px; box-shadow: 0 0 0 1px var(--rule); }}
.icons .mono {{ margin-left: auto; padding: 10px 12px; border-radius: 6px; background: #F3F0E8; box-shadow: 0 0 0 1px var(--rule); }}
.grid2 {{ display: grid; gap: 14px; }}
@media (min-width: 760px) {{ .grid2 {{ grid-template-columns: 1fr 1fr; }} }}
.sws {{ display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }}
.sw {{ display: grid; grid-template-columns: 40px 40px 1fr; grid-template-rows: auto auto; column-gap: 10px; align-items: center; padding: 12px; border: 1px solid var(--rule); border-radius: 10px; background: var(--card); }}
.sw span {{ grid-row: 1 / 3; height: 40px; border-radius: 6px; box-shadow: inset 0 0 0 1px rgba(127,127,127,.35); }}
.sw code {{ color: var(--muted); font-size: 12px; }}
.rules {{ display: grid; gap: 8px 32px; padding: 0; list-style: none; }}
@media (min-width: 760px) {{ .rules {{ grid-template-columns: 1fr 1fr; }} }}
.rules li {{ padding: 10px 0; border-top: 1px solid var(--rule); }}
.rules b {{ color: var(--point); font-weight: 600; }}
.fav {{ display: flex; flex-wrap: wrap; gap: 18px; align-items: end; }}
.fav figure {{ margin: 0; text-align: center; color: var(--muted); font-size: 13px; }}
.fav img {{ display: block; margin: 0 auto 6px; image-rendering: pixelated; }}
</style>
</head>
<body><main>
<p class="eyebrow"><code>Analitik İşler · ai brand · v1.0 · 25 Oct 2026</code></p>
<h1>ai, the Analitik İşler tool family</h1>
<p class="lead"><b>“ai” stands for two things: AI, and the initials of analitik işler.</b> One mark, one red, five tools,
always lowercase. The rules are in <code>BRAND.md</code>; every file below is in <code>assets/</code>. Left tiles are light, right tiles dark.</p>

<h2>The mark and the master logo</h2>
<div class="grid2">
  {pair('assets/mark/ai-mark-light.svg', 'assets/mark/ai-mark-dark.svg', 'ai mark', 72)}
  {pair('assets/master/analitik-isler-light.svg', 'assets/master/analitik-isler-dark.svg', 'Analitik İşler master logo', 34)}
</div>

<h2>Colour</h2>
<p>Two inks and one red. The point and the red pen use the same red as the site's “broken” state: one red, everywhere.</p>
<div class="sws">{colours}</div>

<h2>The five tools</h2>
<p>Horizontal (default), stacked, endorsed; app icons 512 / 64 / 32 on paper and ink; mono at the right.</p>
{"".join(rows)}

<h2>Favicons</h2>
<div class="grid2">
  <div class="product"><header><h3>Every tool</h3><span class="status">the ai mark, pixel-fitted</span></header>
    <div class="fav">{"".join(f'<figure>{img(f"assets/icons/favicon-ai-{n}.svg", f"ai favicon {n}", n)}{n}px</figure>' for n in (16, 32, 64))}
    {"".join(f'<figure>{img(f"assets/icons/favicon-ai-{n}-ink.svg", f"ai favicon {n}, ink", n)}{n}px ink</figure>' for n in (16, 32, 64))}</div></div>
  <div class="product"><header><h3>Analitik İşler (the company)</h3><span class="status">three black bars, no red</span></header>
    <div class="fav"><figure>{img("assets/favicon/analitik-isler-bars.svg", "Analitik İşler favicon", 16)}16px</figure><figure>{img("assets/favicon/analitik-isler-bars.svg", "Analitik İşler favicon", 32)}32px</figure><figure>{img("assets/favicon/analitik-isler-bars.svg", "Analitik İşler favicon", 64)}64px</figure><figure>{img("assets/favicon/apple-touch-icon.png", "Apple touch icon", 64)}touch icon</figure></div></div>
</div>

<h2>Rules in short</h2>
<ul class="rules">
  <li><b>Lowercase, always.</b> ai tag debugger, also at the start of a sentence. Never “AI Tag Debugger”.</li>
  <li><b>Names are not translated.</b> Turkish adds an apostrophe suffix: ai tag debugger’ı, ai visibility’yi, ai cloud’da.</li>
  <li><b>One red point per logo.</b> No product colours; the old orange, teal and blue are retired.</li>
  <li><b>“by analitik işler” is the master logo</b>, with its red point and three bars, never the name in type.</li>
  <li><b>Clear space 2 S</b> (S = the i's stem) on every side; mark x-height at least 9 px.</li>
  <li><b>Status is a word beside the logo</b>, in pencil: Early access, Alpha. Never inside the file.</li>
  <li><b>Same height in a row.</b> Lockups that sit together share one height.</li>
  <li><b>The red pen marks real findings only</b>: a tick, a circle, an underline. Two per screen at most.</li>
  <li><b>No second font.</b> Schibsted lives inside the logo files; UIs use the Analitik İşler system fonts.</li>
</ul>
</main></body></html>
'''
(D / 'board.html').write_text(html)
print('wrote', D / 'board.html')
