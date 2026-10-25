FROM oven/bun:1.4.4
WORKDIR /app
COPY package.json bun.lock ./
RUN --mount=type=secret,id=registry_ca \
    if [ -f /run/secrets/registry_ca ]; then \
      NODE_EXTRA_CA_CERTS=/run/secrets/registry_ca bun install --frozen-lockfile; \
    else bun install --frozen-lockfile; fi
COPY . .
EXPOSE 3000
CMD ["bun", "src/main.ts"]
