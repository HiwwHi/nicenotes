/**
 * 可复现的洗牌。
 *
 * 用同一个 seed 一定得到同一个顺序 —— 这样切到随机模式、翻到一半去展开一条、
 * React 重渲染时列表都不会跳。想换一批，换一个 seed 就行。
 */
export function shuffle<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let state = seed || 1;

  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4_294_967_296;
  };

  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a !== undefined && b !== undefined) {
      out[i] = b;
      out[j] = a;
    }
  }

  return out;
}
