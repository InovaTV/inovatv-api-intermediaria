const B = new URL("./", import.meta.url);
const MAP = {
  "_shared/supabase_client.ts": "fake_supabase_client.mjs",
  "_shared/rocket_sigma_contexto.ts": "fake_rocket_sigma_contexto.mjs",
};
export async function resolve(spec, ctx, next) {
  for (const [suf, f] of Object.entries(MAP)) {
    if (spec.endsWith(suf)) return next(new URL(f, B).href, ctx);
  }
  return next(spec, ctx);
}
