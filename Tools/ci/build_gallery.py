#!/usr/bin/env python3
"""Build a browsable HTML gallery from the CI snapshot renders.

The development machine for this project is Windows, so the UI can never be
opened in a simulator. The snapshots are the only way to look at it, and a
folder of 70 PNGs is not a review surface. This turns them into one page that
can be filtered by theme and type size.

Usage: build_gallery.py <snapshots-dir> <output-dir>
Writes <output-dir>/index.html and copies the PNGs alongside it.
"""

from __future__ import annotations

import json
import re
import shutil
import struct
import sys
from pathlib import Path

# Filename shape produced by SnapshotHarness: "<base>_<theme>-<typesize>.png"
NAME = re.compile(r"^(?P<base>.+)_(?P<theme>light|dark)-(?P<size>L|XXL|AX3)\.png$")

# Ordered so the page reads the way the app is used, not alphabetically.
GROUPS: list[tuple[str, str, list[str]]] = [
    ("screens", "Ekranai", ["screen-root", "screen-probe", "screen-live-activity", "screen-voice"]),
    ("liveactivity", "Gyvoji veikla", [
        "liveactivity-countdown",
        "liveactivity-countdown-single",
        "liveactivity-countdown-vibrant",
        "liveactivity-countdown-accented",
    ]),
    ("island", "Dynamic Island", ["island-compact", "island-expanded", "island-minimal"]),
    ("badges", "Maršrutų ženkliukai", [
        "badges-small", "badges-regular", "badges-large",
        "badges-vibrant-window", "badges-vibrant-swiftui",
        "badges-accented-window", "badges-accented-swiftui",
        "badges-accessibility",
        "route-summary",
    ]),
]

CAPTIONS = {
    "screen-root": "Pradžios ekranas",
    "screen-probe": "Galimybių patikra",
    "screen-live-activity": "Gyvosios veiklos valdymas",
    "screen-voice": "Balso bandymas",
    "liveactivity-countdown": "Atgalinis skaičiavimas, du maršrutai",
    "liveactivity-countdown-single": "Atgalinis skaičiavimas, vienas maršrutas",
    "liveactivity-countdown-vibrant": "Užrakto ekranas (vibrant) — spalva nuimta",
    "liveactivity-countdown-accented": "Užrakto ekranas (accented)",
    "island-compact": "Suskleistas",
    "island-expanded": "Išskleistas",
    "island-minimal": "Minimalus",
    "badges-small": "Mažas — valdikliams",
    "badges-regular": "Normalus — sąrašams",
    "badges-large": "Didelis — gyvajai veiklai",
    "badges-vibrant-window": "Vibrant (UIWindow)",
    "badges-vibrant-swiftui": "Vibrant (ImageRenderer)",
    "badges-accented-window": "Accented (UIWindow)",
    "badges-accented-swiftui": "Accented (ImageRenderer)",
    "badges-accessibility": "Didelis šriftas (AX3)",
    "route-summary": "Maršrutų seka su persėdimu",
}


def png_size(path: Path) -> tuple[int, int]:
    """Width and height straight from the IHDR chunk."""
    header = path.read_bytes()[:24]
    return struct.unpack(">II", header[16:24])


def flatten(src: Path, dest: Path, theme: str) -> None:
    """Copy a snapshot, compositing it onto an opaque backdrop if it has alpha.

    `ImageRenderer` draws onto transparency, so the snapshots it produces have
    a fully transparent background. On a white page they look fine by accident;
    on this gallery's dark theme the backdrop would show through, and a
    knocked-out badge number — which is transparency, by design — would come
    out the colour of the page instead of the colour of the lock screen.

    Compositing here keeps the gallery honest whatever the renderer did.
    """
    try:
        from PIL import Image
    except ImportError:
        shutil.copy2(src, dest)
        return

    image = Image.open(src)
    if image.mode != "RGBA":
        shutil.copy2(src, dest)
        return

    alpha = image.getchannel("A")
    if alpha.getextrema() == (255, 255):      # already fully opaque
        shutil.copy2(src, dest)
        return

    backdrop_colour = (0, 0, 0, 255) if theme == "dark" else (255, 255, 255, 255)
    backdrop = Image.new("RGBA", image.size, backdrop_colour)
    Image.alpha_composite(backdrop, image).convert("RGB").save(dest, "PNG")


def collect(snapshots: Path) -> list[dict]:
    items = []
    for png in sorted(snapshots.glob("*.png")):
        match = NAME.match(png.name)
        if not match:
            print(f"  skipped (unrecognised name): {png.name}")
            continue
        base = match["base"]
        group = next((g[0] for g in GROUPS if base in g[2]), "other")
        width, height = png_size(png)
        items.append({
            "file": png.name,
            "base": base,
            "group": group,
            "theme": match["theme"],
            "size": match["size"],
            "w": width,
            "h": height,
            "caption": CAPTIONS.get(base, base),
            "bytes": png.stat().st_size,
        })
    return items


def build_html(items: list[dict], run_id: str) -> str:
    manifest = json.dumps(items, ensure_ascii=False, separators=(",", ":"))
    groups = json.dumps(
        [{"id": gid, "label": label} for gid, label, _ in GROUPS] + [{"id": "other", "label": "Kita"}],
        ensure_ascii=False,
    )
    return TEMPLATE.replace("__MANIFEST__", manifest) \
                   .replace("__GROUPS__", groups) \
                   .replace("__RUN__", run_id) \
                   .replace("__COUNT__", str(len(items)))


TEMPLATE = r"""<title>Vilnius Commute Snapshots</title>
<style>
  /* Neutrals carry a slight blue bias, taken from the feed's own bus colour
     (#0073AC) rather than a generic grey. */
  :root {
    --page:    #eef1f4;
    --surface: #ffffff;
    --sunk:    #e3e8ed;
    --line:    #d2dae2;
    --ink:     #141a21;
    --muted:   #5b6875;
    --accent:  #0073ac;
    --shadow:  0 1px 2px rgba(20, 26, 33, .08);
    color-scheme: light;
  }
  :root:not([data-theme="light"]) {
    @media (prefers-color-scheme: dark) {
      --page:    #10141a;
      --surface: #181e26;
      --sunk:    #0b0f14;
      --line:    #2a323c;
      --ink:     #e6ecf2;
      --muted:   #8d9aa8;
      --accent:  #4ba8dd;
      --shadow:  0 1px 2px rgba(0, 0, 0, .4);
      color-scheme: dark;
    }
  }
  :root[data-theme="dark"] {
    --page:    #10141a;
    --surface: #181e26;
    --sunk:    #0b0f14;
    --line:    #2a323c;
    --ink:     #e6ecf2;
    --muted:   #8d9aa8;
    --accent:  #4ba8dd;
    --shadow:  0 1px 2px rgba(0, 0, 0, .4);
    color-scheme: dark;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    background: var(--page);
    color: var(--ink);
    font-family: "IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, sans-serif;
    font-size: 15px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  .wrap {
    max-width: 1180px;
    margin: 0 auto;
    padding-inline: 20px;
    padding-block: 28px 64px;
  }

  header h1 {
    margin: 0 0 4px;
    font-size: clamp(22px, 4vw, 30px);
    font-weight: 600;
    letter-spacing: -.02em;
    text-wrap: balance;
  }
  header p {
    margin: 0;
    color: var(--muted);
    max-width: 62ch;
  }
  .meta {
    font-family: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 12px;
    color: var(--muted);
    margin-top: 10px;
  }
  .meta a { color: var(--accent); }

  /* Filters ---------------------------------------------------------- */
  .filters {
    position: sticky;
    top: env(safe-area-inset-top, 0px);
    z-index: 5;
    display: flex;
    flex-wrap: wrap;
    gap: 16px 24px;
    align-items: center;
    margin: 24px 0 8px;
    padding: 12px 14px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 10px;
    box-shadow: var(--shadow);
  }
  .fieldset { display: flex; align-items: center; gap: 8px; }
  .fieldset > span {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: .08em;
    color: var(--muted);
  }
  .seg { display: flex; gap: 2px; background: var(--sunk); padding: 2px; border-radius: 7px; }
  .seg button {
    font: inherit;
    font-size: 13px;
    padding: 5px 12px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }
  .seg button[aria-pressed="true"] {
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--shadow);
  }
  .seg button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .count { margin-left: auto; font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 12px; color: var(--muted); }

  /* Sections --------------------------------------------------------- */
  section { margin-top: 36px; }
  section > h2 {
    margin: 0 0 14px;
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: .09em;
    color: var(--muted);
    padding-bottom: 8px;
    border-bottom: 1px solid var(--line);
  }

  .grid { display: grid; gap: 18px; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); }
  /* Full phone screens are tall; give them their own wider track. */
  .grid.tall { grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }

  figure {
    margin: 0;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 10px;
    overflow: hidden;
    box-shadow: var(--shadow);
  }
  .shot {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--sunk);
    padding: 10px;
  }
  .shot img { max-width: 100%; height: auto; display: block; border-radius: 4px; }
  .grid.tall .shot img { max-height: 520px; width: auto; }

  figcaption { padding: 10px 12px 12px; border-top: 1px solid var(--line); }
  figcaption .name { font-weight: 500; }
  figcaption .file {
    font-family: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 11px;
    color: var(--muted);
    margin-top: 3px;
    font-variant-numeric: tabular-nums;
    word-break: break-all;
  }

  .empty { color: var(--muted); padding: 28px 0; }

  .note {
    margin-top: 44px;
    padding: 14px 16px;
    border-left: 3px solid var(--accent);
    background: var(--surface);
    border-radius: 0 8px 8px 0;
  }
  .note h3 { margin: 0 0 6px; font-size: 14px; }
  .note p { margin: 0 0 8px; color: var(--muted); font-size: 14px; }
  .note p:last-child { margin-bottom: 0; }

  @media (prefers-reduced-motion: no-preference) {
    .seg button { transition: background .12s ease, color .12s ease; }
  }
</style>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">

<div class="wrap">
  <header>
    <h1>Vilnius Commute — ekranai</h1>
    <p>Kiekvieno build’o metu atvaizduoti ekranai. Tai vienintelis būdas pamatyti sąsają be Mac — tikras vaizdas telefone gaunamas tik įsidiegus <code>.ipa</code>.</p>
    <p class="meta">__COUNT__ vaizdų · build <a href="https://github.com/Aistis15/vilnius-commute/actions/runs/__RUN__">__RUN__</a></p>
  </header>

  <div class="filters">
    <div class="fieldset">
      <span>Tema</span>
      <div class="seg" id="theme-seg">
        <button data-v="light" aria-pressed="true">Šviesi</button>
        <button data-v="dark" aria-pressed="false">Tamsi</button>
      </div>
    </div>
    <div class="fieldset">
      <span>Šrifto dydis</span>
      <div class="seg" id="size-seg">
        <button data-v="L" aria-pressed="true">L</button>
        <button data-v="XXL" aria-pressed="false">XXL</button>
        <button data-v="AX3" aria-pressed="false">AX3</button>
      </div>
    </div>
    <span class="count" id="count"></span>
  </div>

  <main id="out"></main>

  <div class="note">
    <h3>Ką šios nuotraukos įrodo ir ko ne</h3>
    <p><strong>Vibrant / accented</strong> režimai čia yra imitacija: jie priverčia mūsų pačių vaizdą pasirinkti nespalvotą kelią, bet neatkartoja sistemos tonavimo. Tikrą vaizdą rodo tik telefonas.</p>
    <p><strong>Navigacijos antraštės</strong> atrodo išblukusios — tai atvaizdavimo artefaktas, ne programėlės klaida.</p>
  </div>
</div>

<script>
  const ITEMS = __MANIFEST__;
  const GROUPS = __GROUPS__;
  const state = { theme: "light", size: "L" };

  const out = document.getElementById("out");
  const countEl = document.getElementById("count");

  function wire(id, key) {
    const seg = document.getElementById(id);
    seg.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      state[key] = btn.dataset.v;
      for (const b of seg.querySelectorAll("button")) {
        b.setAttribute("aria-pressed", String(b === btn));
      }
      render();
    });
  }

  function render() {
    const shown = ITEMS.filter(i => i.theme === state.theme && i.size === state.size);
    countEl.textContent = shown.length + " / " + ITEMS.length;
    out.innerHTML = "";

    if (!shown.length) {
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = "Šiam deriniui vaizdų nėra — AX3 atvaizduojamas tik ženkliukams.";
      out.append(p);
      return;
    }

    for (const g of GROUPS) {
      const items = shown.filter(i => i.group === g.id);
      if (!items.length) continue;

      const section = document.createElement("section");
      const h2 = document.createElement("h2");
      h2.textContent = g.label;
      section.append(h2);

      const grid = document.createElement("div");
      grid.className = "grid" + (g.id === "screens" ? " tall" : "");

      for (const item of items) {
        const fig = document.createElement("figure");

        const shot = document.createElement("div");
        shot.className = "shot";
        const img = document.createElement("img");
        img.src = "snapshots/" + item.file;
        img.alt = item.caption;
        img.loading = "lazy";
        img.width = item.w;
        img.height = item.h;
        shot.append(img);

        const cap = document.createElement("figcaption");
        const name = document.createElement("div");
        name.className = "name";
        name.textContent = item.caption;
        const file = document.createElement("div");
        file.className = "file";
        file.textContent = item.w + "×" + item.h + " · " + item.file;
        cap.append(name, file);

        fig.append(shot, cap);
        grid.append(fig);
      }

      section.append(grid);
      out.append(section);
    }
  }

  wire("theme-seg", "theme");
  wire("size-seg", "size");
  render();
</script>
"""


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit("usage: build_gallery.py <snapshots-dir> <output-dir> [run-id]")

    snapshots = Path(sys.argv[1])
    out_dir = Path(sys.argv[2])
    run_id = sys.argv[3] if len(sys.argv) > 3 else ""

    items = collect(snapshots)
    if not items:
        raise SystemExit(f"no snapshots found in {snapshots}")

    shots_out = out_dir / "snapshots"
    shots_out.mkdir(parents=True, exist_ok=True)
    for item in items:
        flatten(snapshots / item["file"], shots_out / item["file"], item["theme"])

    (out_dir / "index.html").write_text(build_html(items, run_id), encoding="utf-8")

    total = sum(i["bytes"] for i in items)
    print(f"gallery: {len(items)} images, {total/1e6:.1f} MB -> {out_dir/'index.html'}")


if __name__ == "__main__":
    main()
