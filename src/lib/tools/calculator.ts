// src/lib/tools/calculator.ts

export function calculate(expression: string): string {
  try {
    // A very constrained and safe math evaluator
    // Only allows digits, basic operators, and parens
    if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
      return "Error: Invalid characters in expression.";
    }
    
    // eslint-disable-next-line no-new-func
    const result = new Function(`return ${expression}`)();
    return String(result);
  } catch (e) {
    return `Error evaluating expression: ${String(e)}`;
  }
}
