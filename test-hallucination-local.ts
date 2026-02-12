
import { detectHallucinations } from './src/lib/ai/hallucination-detector';

const testCases = [
  "你掏出5金币放在柜台上。",
  "你从背包里拿出10个金币递给掌柜。",
  "你数了数，掏出了 5 金币。",
  "你花费了100灵石购买了这把剑。",
  "掌柜收下你的50金币，把东西给你。",
  "你把这块精铁放入背包。",
  "你小心翼翼地将刚刚买到的药水装进收纳袋。",
];

console.log("Testing Hallucination Detector Patterns...");

testCases.forEach((text, index) => {
  const result = detectHallucinations(text, []); // No tools called
  console.log(`\nTest Case #${index + 1}: "${text}"`);
  console.log(`Result: ${result.hasHallucination ? '✅ CAUGHT' : '❌ MISSED'}`);
  if (result.hasHallucination) {
    console.log(`Reason: ${result.reason}`);
  }
});
