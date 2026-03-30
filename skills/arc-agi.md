# ARC-AGI-3 Skill

## What is ARC-AGI-3?

The third iteration of the Abstract and Reasoning Corpus (ARC-AGI-3) benchmark by Arc Prize. Each task presents 2–5 input/output example pairs on a 2D integer grid. You must infer the transformation rule and apply it to a test input.

**API Docs**: https://docs.arcprize.org/
**Grid colors**: 0=black 1=blue 2=red 3=green 4=yellow 5=grey 6=magenta 7=orange 8=azure 9=maroon

---

## Core Strategy (Apply in Order)

```
1. Dimensions — Does output size match input? If not, what's the rule?
2. Changed cells — Which cells changed? Which stayed constant?
3. Object identification — Find contiguous colored regions (flood-fill grouping)
4. Geometric transforms — rotation 90/180/270, reflection H/V, translation
5. Color mapping — Does color A always become color B?
6. Counting patterns — Number of X → output size, position, or color
7. Symmetry — Complete half-grid, or fill to make symmetric
8. Masking — Use one grid as mask/template over another
9. Gravity — Objects fall toward edge/center
10. Replication — Object copied/tiled to fill output
ALWAYS validate on ALL training examples before applying to test input.
```

---

## Task Loading

```python
run_python("""
import json, pathlib

task = json.loads(pathlib.Path('workspace/arc_task.json').read_text())
print(f"Train examples: {len(task['train'])}  Test inputs: {len(task['test'])}")
for i, ex in enumerate(task['train']):
    inp = ex['input']
    out = ex['output']
    print(f"\\nExample {i+1}: {len(inp)}x{len(inp[0])} -> {len(out)}x{len(out[0])}")
    for row in inp: print('  IN  ', row)
    for row in out: print('  OUT ', row)
print("\\nTEST INPUT:")
for row in task['test'][0]['input']:
    print(' ', row)
""")
```

---

## Python Solver Template (numpy)

```python
run_python("""
import json, pathlib, numpy as np
from itertools import product

task = json.loads(pathlib.Path('workspace/arc_task.json').read_text())

def solve(grid_list):
    g = np.array(grid_list)
    # ── YOUR TRANSFORMATION HERE ──
    # Examples:
    # return np.rot90(g).tolist()          # 90° rotation
    # return np.flipud(g).tolist()         # vertical flip
    # return np.fliplr(g).tolist()         # horizontal flip
    # return (g == 1).astype(int).tolist() # color mask
    # return g.T.tolist()                  # transpose
    return g.tolist()

# Validate on all training examples
score = 0
for i, ex in enumerate(task['train']):
    pred = solve(ex['input'])
    ok = pred == ex['output']
    score += int(ok)
    status = "✓" if ok else "✗"
    print(f"{status} Example {i+1}")
    if not ok:
        print(f"  Expected: {ex['output']}")
        print(f"  Got:      {pred}")

total = len(task['train'])
print(f"\\nScore: {score}/{total} {'PERFECT' if score == total else ''}")

if score == total:
    result = solve(task['test'][0]['input'])
    print("\\nTEST RESULT:")
    for row in result: print(' ', row)
    pathlib.Path('workspace/arc_result.json').write_text(json.dumps(result))
    print("Saved to workspace/arc_result.json")
""")
```

---

## Advanced: Object Detection + Manipulation

```python
run_python("""
import json, numpy as np
from pathlib import Path

def find_objects(grid):
    \"\"\"Find all contiguous same-color regions via flood-fill.\"\"\"
    g = np.array(grid)
    visited = np.zeros_like(g, dtype=bool)
    objects = []
    for r in range(g.shape[0]):
        for c in range(g.shape[1]):
            if not visited[r, c] and g[r, c] != 0:
                # BFS flood-fill
                color = g[r, c]
                cells = []
                queue = [(r, c)]
                while queue:
                    cr, cc = queue.pop()
                    if cr < 0 or cr >= g.shape[0] or cc < 0 or cc >= g.shape[1]: continue
                    if visited[cr, cc] or g[cr, cc] != color: continue
                    visited[cr, cc] = True
                    cells.append((cr, cc))
                    queue.extend([(cr+1,cc),(cr-1,cc),(cr,cc+1),(cr,cc-1)])
                if cells:
                    rows = [c[0] for c in cells]
                    cols = [c[1] for c in cells]
                    objects.append({
                        'color': int(color),
                        'cells': cells,
                        'bbox': (min(rows), min(cols), max(rows), max(cols)),
                        'size': len(cells),
                    })
    return objects

task = json.loads(Path('workspace/arc_task.json').read_text())
for i, ex in enumerate(task['train'][:2]):
    objs = find_objects(ex['input'])
    print(f"Example {i+1}: {len(objs)} objects")
    for obj in objs:
        print(f"  color={obj['color']} size={obj['size']} bbox={obj['bbox']}")
""")
```

---

## Hypothesis Testing Framework

```python
run_python("""
import json, numpy as np
from pathlib import Path

task = json.loads(Path('workspace/arc_task.json').read_text())
train = task['train']

# ── Analyze patterns ──
print("=== PATTERN ANALYSIS ===")

# 1. Size analysis
for i, ex in enumerate(train):
    ih, iw = len(ex['input']), len(ex['input'][0])
    oh, ow = len(ex['output']), len(ex['output'][0])
    size_same = (ih == oh and iw == ow)
    print(f"Ex {i+1}: {ih}x{iw} -> {oh}x{ow}  {'same size' if size_same else 'SIZE CHANGE'}")

# 2. Color usage
all_in_colors  = set(c for ex in train for row in ex['input'] for c in row)
all_out_colors = set(c for ex in train for row in ex['output'] for c in row)
print(f"\\nInput colors: {sorted(all_in_colors)}")
print(f"Output colors: {sorted(all_out_colors)}")
new_colors = all_out_colors - all_in_colors
print(f"New colors in output: {sorted(new_colors)}")

# 3. Symmetry check
def is_symmetric_h(g): return g == np.flipud(g).tolist()
def is_symmetric_v(g): return g == np.fliplr(np.array(g)).tolist()
for i, ex in enumerate(train):
    sh = is_symmetric_h(ex['output'])
    sv = is_symmetric_v(ex['output'])
    if sh or sv:
        print(f"Ex {i+1} output is {'H' if sh else ''}{'V' if sv else ''} symmetric")
""")
```

---

## ARC-AGI-3 API Submission

```python
run_python("""
import json, requests
from pathlib import Path

# Load your result
result = json.loads(Path('workspace/arc_result.json').read_text())
task_id = 'TASK_ID_HERE'

# Format for API submission
attempt = {
    'task_id': task_id,
    'attempts': [
        {'output': result},   # attempt 1
    ]
}

# Submit (requires API key from arcprize.org)
# response = requests.post(
#     'https://api.arcprize.org/v1/submit',
#     headers={'Authorization': 'Bearer YOUR_KEY'},
#     json=attempt,
# )
# print(response.json())
print(json.dumps(attempt, indent=2))
""")
```

---

## Vision-Assisted Analysis (when screenshot available)

```python
run_python("""
import json
from pathlib import Path

# Load task and render as colored ASCII for visual inspection
COLORS = {0:'·',1:'B',2:'R',3:'G',4:'Y',5:'.',6:'M',7:'O',8:'A',9:'N'}
ANSI = {
    0:'\x1b[90m', 1:'\x1b[34m', 2:'\x1b[31m', 3:'\x1b[32m',
    4:'\x1b[33m', 5:'\x1b[37m', 6:'\x1b[35m', 7:'\x1b[33m',
    8:'\x1b[36m', 9:'\x1b[31m'
}
RST = '\x1b[0m'

task = json.loads(Path('workspace/arc_task.json').read_text())
for i, ex in enumerate(task['train'][:3]):
    print(f"\\n--- Example {i+1} ---")
    for row in ex['input']:
        print('IN  ' + ' '.join(ANSI[c]+COLORS[c]+RST for c in row))
    for row in ex['output']:
        print('OUT ' + ' '.join(ANSI[c]+COLORS[c]+RST for c in row))
""")
```

---

## Best Practices

1. **Read the skill first** — `read_skill("arc-agi")` at the start of each session
2. **Always validate on all training examples** — Never submit without 100% training accuracy
3. **Start simple** — Try color swap, rotation, flip first; complex transforms later
4. **Use numpy** — Array operations are faster and less error-prone than nested loops
5. **Visualize** — Print the colored grid to understand the pattern visually
6. **Iterative refinement** — When stuck, print intermediate steps of your transform
7. **Store solutions** — Use `memory_store` when you find a pattern that works; same patterns recur
