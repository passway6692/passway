export function compareTimes(a: string, b: string): number {
  const [ah, am] = a.split(":").map(Number);
  const [bh, bm] = b.split(":").map(Number);
  if (ah === bh) return am - bm;
  return ah - bh;
}
