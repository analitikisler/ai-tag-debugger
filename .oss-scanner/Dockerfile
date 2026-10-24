# Build image for Anthropic's OSS Scanner (https://github.com/anthropics/oss-scanner).
# The scanner copies this checkout into the image with network access, then audits it with none,
# so everything the tests need (npm packages, Chromium and its system libraries) is fetched here.
# Same Node major as CI's upper bound and the dev container.
FROM node:22-bookworm

ENV CI=true \
    # A fixed, world-readable location so Chromium is found whatever user runs the audit.
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY . /src
WORKDIR /src

# No install scripts run from dependencies. The pinned Playwright installs the Chromium build it
# expects plus its Debian libraries, the same two steps as `npm run setup -- --with-deps`.
RUN npm ci --ignore-scripts \
 && npx playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/* \
 && chmod -R a+rX /ms-playwright

# The test suite needs no API key and no Internet: the model clients are fakes and the end-to-end
# tests start the demo shop (examples/serve.js) on localhost themselves. A failure here is a
# warning, not a build failure, so a flaky browser test does not block the audit.
RUN npm test || echo "WARNING: tests reported failures"
