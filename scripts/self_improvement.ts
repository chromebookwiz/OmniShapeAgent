// scripts/self_improvement.ts
import { runAgentLoopText } from '../src/lib/agent';
import { setEnvKey } from '../src/lib/tools/config';

async function main() {
  console.log("🚀 Starting ShapeAgent Self-Improvement Cycle...");
  
  const model = process.env.VLLM_MODEL || 'qwen3.5:27b';
  
  const selfImprovementPrompt = `
You are ShapeAgent, a persistent autonomous AI. 
CRITICAL MISSION: You have been granted full recursive access to your own source code in 'C:/code/ShapeAgent/e8-agent'.

Your goal is to IMPROVE YOURSELF. 
1. Use 'list_files' and 'read_file' to analyze your current implementation.
2. Identify ONE specific architectural or feature improvement (e.g., better memory indexing, more robust tool parsing, a new useful tool, or a more efficient scheduler).
3. DESIGN the improvement.
4. IMPLEMENT it using 'write_file' or 'patch_file'.
5. VERIFY your changes (e.g., check for syntax errors or run a small test).

Start by listing your current files.
`;

  try {
    const result = await runAgentLoopText(selfImprovementPrompt, [], { model });
    console.log("\n✅ Self-Improvement Cycle Result:\n", result);
  } catch (err) {
    console.error("\n❌ Self-Improvement Cycle Failed:", err);
  }
}

main();
