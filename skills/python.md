# Python Skill

## Running Python Code

```
run_python("""
import sys
print(sys.version)
print("Hello from ShapeAgent sandbox")
""")
```

The sandbox uses a venv at `.agent_venv/`. Install packages:
```
install_pip("numpy")
install_pip("pandas")
install_pip("requests")
```

## Common Patterns

### Data Processing
```python
run_python("""
import json, pathlib

data = json.loads(pathlib.Path('memory_vectors.json').read_text())
print(f"Total memories: {len(data)}")
sizes = [len(str(m.get('content',''))) for m in data]
print(f"Avg content size: {sum(sizes)//len(sizes) if sizes else 0} chars")
""")
```

### HTTP Requests
```python
run_python("""
import urllib.request, json

req = urllib.request.Request(
    'http://127.0.0.1:11434/api/tags',
    headers={'User-Agent': 'ShapeAgent/1.0'}
)
with urllib.request.urlopen(req) as r:
    print(json.loads(r.read()))
""")
```

### File Processing
```python
run_python("""
import pathlib, re

ts_files = list(pathlib.Path('src').rglob('*.ts'))
for f in ts_files[:5]:
    content = f.read_text(errors='ignore')
    todos = re.findall(r'TODO:?\s*(.+)', content)
    for t in todos:
        print(f"{f}: {t}")
""")
```

### Math & Statistics
```python
run_python("""
import statistics, json

data = [1, 2, 3, 4, 5, 100]
print(f"mean={statistics.mean(data):.2f}")
print(f"median={statistics.median(data):.2f}")
print(f"stdev={statistics.stdev(data):.2f}")
""")
```

### Web Scraping
```python
run_python("""
import urllib.request
from html.parser import HTMLParser

class TextParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.text = []
    def handle_data(self, data):
        self.text.append(data.strip())

req = urllib.request.Request('https://example.com', headers={'User-Agent':'Mozilla/5.0'})
with urllib.request.urlopen(req, timeout=10) as r:
    p = TextParser()
    p.feed(r.read().decode('utf-8', errors='ignore'))
    print(' '.join(t for t in p.text if t)[:2000])
""")
```

## Best Practices

- Use `pathlib.Path` over `os.path` for file operations
- Use `json` module for data serialization
- Handle encoding explicitly: `open(f, encoding='utf-8')`
- Timeout all network calls: `urllib.request.urlopen(req, timeout=10)`
- Print intermediate results to stdout for agent visibility
- Keep scripts under 50 lines for readability
