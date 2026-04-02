import base64
import io
import json
import math
import sys


def fail(message: str) -> None:
    sys.stdout.write(json.dumps({"ok": False, "error": message}))
    sys.exit(0)


try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.collections import PolyCollection
    from matplotlib.patches import Circle, Wedge
except Exception:
    fail("matplotlib not available")


def polar_to_cart(theta: float, radius: float) -> tuple[float, float]:
    return math.cos(theta) * radius, math.sin(theta) * radius


def main() -> None:
    raw = sys.stdin.read().strip()
    if not raw:
      fail("no input")
    payload = json.loads(raw)
    analysis = payload.get("analysis") or {}
    theme = payload.get("theme") or "resonance"
    vibration = analysis.get("vibration") or []
    path = analysis.get("path") or []
    metrics = analysis.get("metrics") or {}

    if not vibration:
        fail("analysis missing vibration")

    bg = "#040712" if theme != "ethics" else "#120903"
    virtue = float(metrics.get("virtue", 0.0))
    entropy = float(metrics.get("entropy", 0.0))
    path_color = "#22c55e" if virtue >= entropy else "#f97316"

    fig, ax = plt.subplots(figsize=(8, 8), facecolor=bg)
    ax.set_facecolor(bg)
    ax.set_aspect("equal")
    ax.set_xlim(-1.25, 1.25)
    ax.set_ylim(-1.25, 1.25)
    ax.axis("off")

    ax.add_patch(Circle((0, 0), 1.0, fill=False, lw=1.1, ec="#334155", alpha=0.65))
    ax.add_patch(Circle((0, 0), 0.56, fill=False, lw=0.9, ec="#1e293b", alpha=0.8))

    bins = len(vibration)
    for index, value in enumerate(vibration):
        start = 360.0 * index / bins - 90.0
        end = 360.0 * (index + 1) / bins - 90.0
        magnitude = max(0.02, min(1.0, abs(float(value))))
        outer = 0.58 + 0.28 * magnitude
        color = "#34d399" if float(value) >= 0 else "#fb7185"
        wedge = Wedge((0, 0), outer, start, end, width=outer - 0.56)
        wedge.set_facecolor(color)
        wedge.set_edgecolor("none")
        wedge.set_alpha(0.08 + magnitude * 0.45)
        ax.add_patch(wedge)

    polys = []
    for idx in range(1, len(path)):
        prev = path[idx - 1]
        cur = path[idx]
        polys.append([
            (prev["x"] * 0.84, prev["y"] * 0.84),
            (cur["x"] * 0.84, cur["y"] * 0.84),
            (cur["x"] * 0.84 + 0.002, cur["y"] * 0.84 + 0.002),
        ])
    if polys:
        collection = PolyCollection(polys, closed=False, facecolors="none", edgecolors=path_color, linewidths=2.2, alpha=0.82)
        ax.add_collection(collection)

    for idx, point in enumerate(path):
        px = point["x"] * 0.84
        py = point["y"] * 0.84
        ax.add_patch(Circle((px, py), 0.014 if idx else 0.022, color="#e2e8f0", alpha=0.9))
        ax.add_patch(Circle((px, py), 0.05 if idx else 0.075, color=path_color, alpha=0.1))

    ax.text(0, 1.12, "OmniShape Resonator", color="#e2e8f0", ha="center", va="center", fontsize=18, family="serif")
    ax.text(0, 1.02, f"virtue {virtue:.2f}  ·  entropy {entropy:.2f}", color="#94a3b8", ha="center", va="center", fontsize=10, family="monospace")

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=160, bbox_inches="tight", pad_inches=0.08, facecolor=bg)
    plt.close(fig)
    encoded = base64.b64encode(buf.getvalue()).decode("ascii")
    sys.stdout.write(json.dumps({"ok": True, "mimeType": "image/png", "dataUrl": f"data:image/png;base64,{encoded}"}))


if __name__ == "__main__":
    main()