// Runs independent jobs a few at a time. Each journey and consent scenario opens its own browser,
// so an audit with several journeys and viewports finishes sooner when they run side by side.
export const MAX_CONCURRENCY = 8;

/** The number of jobs to run at once, from --concurrency, the config or the MCP tool. Default 1, at most 8. */
export function parseConcurrency(value) {
  if (value === undefined || value === null || value === "") return 1;
  // Only a number or a numeric string counts: true would otherwise pass as 1.
  const n = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  if (!(Number.isInteger(n) && n >= 1 && n <= MAX_CONCURRENCY)) throw new Error(`"concurrency" must be a whole number from 1 to ${MAX_CONCURRENCY} (--concurrency <n>, or "concurrency" in the config).`);
  return n;
}

/**
 * Runs worker(job, index) for every job, at most `limit` at a time, and returns the results in the jobs'
 * order, not the order they finished in. A worker that throws rejects the pool, so callers keep each
 * job's errors inside the worker. With a limit of 1 the jobs run strictly one after another.
 */
export async function runPool(jobs, limit, worker) {
  const results = new Array(jobs.length);
  let next = 0;
  // Each lane takes the next job as soon as its own is done, so the lanes stay busy whatever the job lengths.
  const lane = async () => {
    while (next < jobs.length) {
      const i = next++;
      results[i] = await worker(jobs[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, jobs.length)) }, lane));
  return results;
}

/** A log whose every line starts with a tag, so the lines of jobs running side by side can be told apart. */
export const taggedLog = (log, tag) => (message) => log(String(message).replace(/^(?=.)/gm, `${tag} `));
