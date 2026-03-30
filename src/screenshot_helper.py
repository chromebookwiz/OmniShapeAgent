import base64
from pathlib import Path
from .tools import screenshot  # existing low‑level screenshot function

# Tiny 1×1 px placeholder (transparent PNG) – used if capture fails
PLACEHOLDER_BASE64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAoAAAAHgCAYAAAD5D9Z8AAAABHNCSVQICAgIfAhkiAAAAAlwSFlz"
    "AAAOxAAADsQBlSsOGwAAB9tJREFUeJzt3X1sXNUdx/Hv3r13p7ZtKpUqKChQg5DEu0iB0KZgkJxYEkFJk8zQoQKMWxKDEwE8l0iTSRCYlIKC4JCQpI1JUkDUlVQF1AQV9KqX+SFAiV6VqVx+V+vm7/"
    "vV3udk1OP1+0z9n+7t+7v+5t7b/0N3V3U8n2+3/6Lq5vfiS9aXc2YAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABgBA9Hh8AABAPhF6pAALgAAACgAAABgQkAAAABAAcAABYAGgAAAIAAAABAAEAAAQAAAQAAAABAAAAAIAAAAAAAAAAB/8c6fXkAAABJRU5ErkJggg=="
)

def capture_and_embed_screenshot(alt_text: str = "screenshot") -> str:
    """Capture the screen, encode it as Base64, and return a markdown image tag.
    If anything goes wrong, return a tiny placeholder image so the markdown always renders.
    """
    try:
        # Capture – the low‑level `screenshot` returns the path it saved to.
        path = screenshot(output_path="arc_agi_screenshot.png")
        if not path or not Path(path).exists():
            raise FileNotFoundError
        with open(path, "rb") as f:
            raw = f.read()
        b64 = base64.b64encode(raw).decode("utf-8")
    except Exception:
        b64 = PLACEHOLDER_BASE64
    return f"![{alt_text}](data:image/png;base64,{b64})"
