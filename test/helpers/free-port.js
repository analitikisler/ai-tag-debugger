// A port nobody is listening on right now. The demo shop tests used fixed ports, so two suites on one
// machine (or a demo shop left running) cancelled each other's before() hooks with EADDRINUSE.
import { createServer } from "node:net";

export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}
