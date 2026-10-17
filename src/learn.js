import { PROVIDERS } from "./parsers.js";

/**
 * A plan learned from what a site already sends: one event per platform and event name seen in
 * the runs, the parameters it carried,. Parameters sent with every
 * hit of an event become its required parameters. Values are not copied, so nothing a visitor typed
 * ends up in the plan. Returns null when the runs captured no named events.
 */
export function learnPlan(site, runs) {
  const byKey = new Map();
  for (const run of runs) {
    for (const hit of run.hits ?? []) {
      if (!hit?.platform || !hit.name || hit.name === "(unnamed)") continue;
      const k = `${hit.platform}:${hit.name}`;
      let ev = byKey.get(k);
      if (!ev) byKey.set(k, (ev = { platform: hit.platform, name: hit.name, hits: 0, params: new Map() }));
      ev.hits++;
      for (const p of Object.keys(hit.params ?? {})) ev.params.set(p, (ev.params.get(p) ?? 0) + 1);
    }
  }
  if (!byKey.size) return null;
  const events = [...byKey.values()].map((ev) => {
    const required = [...ev.params].filter(([, n]) => n === ev.hits).map(([p]) => p);
    return {
      platform: ev.platform,
      name: ev.name,
      description: `Learned from what ${PROVIDERS[ev.platform] ?? ev.platform} received on the site.`,
      ...(required.length ? { required_params: required } : {}),
      parameters: Object.fromEntries([...ev.params.keys()].map((p) => [p, {}])),
      seen: true,
    };
  });
  return { site, learned: true, consent_mode: true, pages: [], events, user_properties: [] };
}
