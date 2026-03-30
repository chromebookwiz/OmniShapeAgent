import sys, subprocess, json, os

# Helper to run pip commands safely
def pip_install(pkg):
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', '--quiet', pkg])

# ------------------------------------------------------------
# Ensure required packages are present (torch, torchvision, matplotlib, numpy)
# Import‑check pattern – install only if ImportError occurs
try:
    import torch
except ImportError:
    pip_install('torch')
    import torch

try:
    import torchvision
except ImportError:
    pip_install('torchvision')
    import torchvision

try:
    import matplotlib.pyplot as plt
except ImportError:
    pip_install('matplotlib')
    import matplotlib.pyplot as plt

try:
    import numpy as np
except ImportError:
    pip_install('numpy')
    import numpy as np

# ------------------------------------------------------------
# 1️⃣ Generate a synthetic sinusoidal time‑series
seq_len = 200          # total length
t = np.linspace(0, 4 * np.pi, seq_len)
signal = np.sin(t) + 0.1 * np.random.randn(seq_len)   # sine + slight noise

# Convert to torch tensor (float32)
signal_t = torch.from_numpy(signal).float().unsqueeze(1)  # shape (seq_len, 1)

# 2️⃣ Build a tiny 1‑layer LSTM predictor
input_size = 1
hidden_size = 16
num_layers = 1
model = torch.nn.LSTM(input_size, hidden_size, num_layers)
fc = torch.nn.Linear(hidden_size, 1)  # map hidden → output
criterion = torch.nn.MSELoss()
optimizer = torch.optim.Adam(list(model.parameters()) + list(fc.parameters()), lr=0.01)

# 3️⃣ Training loop – predict next value from previous window of size=5
window = 5
epochs = 150
for epoch in range(epochs):
    epoch_loss = 0.0
    for i in range(seq_len - window - 1):
        # Prepare input sequence (window steps) and target (next step)
        seq_input = signal_t[i:i+window].unsqueeze(1)   # shape (window, 1, 1)
        target = signal_t[i+window].unsqueeze(0)       # shape (1, 1)

        # Reset hidden state each forward pass (stateless LSTM for simplicity)
        hidden = (torch.zeros(num_layers, 1, hidden_size), torch.zeros(num_layers, 1, hidden_size))
        out, hidden = model(seq_input, hidden)        # out shape (window, 1, hidden)
        pred = fc(out[-1])                             # use last output
        loss = criterion(pred, target)
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()
        epoch_loss += loss.item()
    if (epoch+1) % 30 == 0:
        print(f"Epoch {epoch+1:3d}/{epochs} – loss: {epoch_loss/(seq_len-window):.6f}")

# 4️⃣ Evaluation – one‑step ahead prediction over the whole series
model.eval()
preds = []
with torch.no_grad():
    for i in range(seq_len - window):
        seq_input = signal_t[i:i+window].unsqueeze(1)
        hidden = (torch.zeros(num_layers, 1, hidden_size), torch.zeros(num_layers, 1, hidden_size))
        out, hidden = model(seq_input, hidden)
        pred = fc(out[-1])
        preds.append(pred.item())

# Align predictions with true values (starting at index=window)
true_vals = signal[window:]
pred_vals = np.array(preds)

mse = np.mean((true_vals - pred_vals) ** 2)
print(f"Final MSE on the synthetic series: {mse:.6f}")

# 5️⃣ Plot true vs predicted
plt.figure(figsize=(8,4))
plt.plot(true_vals, label='True', linewidth=1.5)
plt.plot(pred_vals, label='Predicted', linewidth=1.5, alpha=0.8)
plt.title('Temporal Synchronization Test – LSTM 1‑step Prediction')
plt.xlabel('Time step (after window)')
plt.ylabel('Signal amplitude')
plt.legend()
plot_path = os.path.abspath('temp_sync_plot.png')
plt.tight_layout()
plt.savefig(plot_path)
print(json.dumps({"status":"completed","mse":mse,"plot_path":plot_path}))
