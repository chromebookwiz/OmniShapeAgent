# ShapeAgent Neural Synergy Architecture

ShapeAgent E8 features a sophisticated dual-backend orchestration system designed to leverage the unique strengths of both local (Ollama) and cluster-based (vLLM) inference engines.

## 1. Parallel Autonomous Mode (||)
**Objective**: Continuous, visible discourse between two independent models.

- **Initialization**: Activating Parallel Mode prompts for a starting topic.
- **Back-and-Forth Dialogue**: 
    - The **vLLM Architect** provides the primary response.
    - The **Ollama Auditor** analyzes and responds to the Architect's reasoning.
- **Autonomous Loop**: The system automatically feeds the previous model's output back to its partner, creating a self-sustaining collaborative chain.
- **Visibility**: Both models' "Neural Reflections" (Thinking blocks) are displayed individually, providing full transparency into the multi-agent logic.

## 2. Neural synchronization Mode (~)
**Objective**: Tight coupling where models work in a single synchronized state.

- **Neural Backbone**: The companion model (Ollama) preparation layer runs in the background to generate "Conceptual Weights" and architectural ideas based on the user's message and long-term memory.
- **Synchronized Finality**: These weights are fused into the lead model's (vLLM) context, ensuring the final assistant response is grounded in both local knowledge and cluster-scale intelligence.
- **Dual-Reasoning**: Even in sync mode, you see the combined "Reflections" of both models within the single response turn.

## 3. UI Controls
- **Parallel Button (||)**: Toggles the autonomous dialogue state. 
- **Neural Button (~)**: Toggles the background synchronization state.
- **Switching**: Activating one mode automatically disengages the other to ensure architectural consistency.

---
*ShapeAgent: Orchestrating Intelligence Through Neural Synergy.*
