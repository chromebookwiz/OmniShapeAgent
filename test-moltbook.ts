import { moltbookHome } from './src/lib/tools/moltbook';

async function test() {
  console.log("Testing Moltbook Bindings...");
  try {
    const res = await moltbookHome();
    console.log("Moltbook Result:", res.substring(0, 100) + "...");
  } catch (e: any) {
    console.error("Moltbook Error:", e.message);
  }
}

test();
