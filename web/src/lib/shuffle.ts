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

  /*
   * 先空转几轮再开始洗。
   *
   * xorshift 的状态如果很小（比如 seed=1），头几个输出的低位相关性很强：
   * 实测 seed 取 1..1000 时，第一个元素永远轮不到第一位 —— 1000 次里
   * 0 次。实际用的 seed 是随机大数，碰不到这个坑，但算法不该有这种死角。
   */
  next();
  next();
  next();
  next();

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
