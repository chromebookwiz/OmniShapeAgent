import json, os, numpy as np, matplotlib.pyplot as plt

# ------------------------------------------------------------
# 1️⃣ Generate synthetic noisy sine wave
seq_len = 300
t = np.linspace(0, 6 * np.pi, seq_len)
signal = np.sin(t) + 0.1 * np.random.randn(seq_len)  # sine + noise

# 2️⃣ Create sliding windows (window size = 5)
window = 5
X = np.stack([signal[i:i+window] for i in range(seq_len - window)], axis=0)  # shape (N, window)
y = signal[window:]  # shape (N,)

# 3️⃣ Simple MLP (one hidden layer) implemented with NumPy
np.random.seed(42)
input_dim = window
hidden_dim = 16
output_dim = 1

W1 = np.random.randn(input_dim, hidden_dim) * 0.1
b1 = np.zeros(hidden_dim)
W2 = np.random.randn(hidden_dim, output_dim) * 0.1
b2 = np.zeros(output_dim)

learning_rate = 0.01
epochs = 300

def relu(x):
    return np.maximum(0, x)

def relu_deriv(x):
    return (x > 0).astype(float)

for epoch in range(epochs):
    # forward pass
    z1 = X @ W1 + b1          # (N, hidden)
    a1 = relu(z1)             # (N, hidden)
    preds = a1 @ W2 + b2       # (N, 1)
    loss = np.mean((preds.squeeze() - y) ** 2)

    # backward pass
    grad_out = 2 * (preds.squeeze() - y) / y.shape[0]          # (N,)
    grad_W2 = a1.T @ grad_out[:, None]                        # (hidden, 1)
    grad_b2 = grad_out.sum()
    grad_a1 = grad_out[:, None] @ W2.T                        # (N, hidden)
    grad_z1 = grad_a1 * relu_deriv(z1)                        # (N, hidden)
    grad_W1 = X.T @ grad_z1                                   # (input, hidden)
    grad_b1 = grad_z1.sum(axis=0)

    # update parameters
    W2 -= learning_rate * grad_W2
    b2 -= learning_rate * grad_b2
    W1 -= learning_rate * grad_W1
    b1 -= learning_rate * grad_b1

    if (epoch + 1) % 50 == 0:
        print(f"Epoch {epoch+1:3d}/{epochs} – MSE: {loss:.6f}")

# ------------------------------------------------------------
# 4️⃣ Evaluation (one‑step ahead on the same series)
final_preds = (relu(X @ W1 + b1) @ W2 + b2).squeeze()
final_mse = np.mean((final_preds - y) ** 2)
print(f"Final MSE: {final_mse:.6f}")

# 5️⃣ Plot true vs predicted
plt.figure(figsize=(8, 4))
plt.plot(y, label='True', linewidth=1.5)
plt.plot(final_preds, label='Predicted', linewidth=1.5, alpha=0.8)
plt.title('Temporal Sync Test – NumPy MLP 1‑step Prediction')
plt.xlabel('Time step (after window)')
plt.ylabel('Amplitude')
plt.legend()
plot_path = os.path.abspath('temp_sync_plot.png')
plt.tight_layout()
plt.savefig(plot_path)

# Emit JSON result for the outer agent
print(json.dumps({"status":"completed","mse":final_mse,"plot_path":plot_path}))