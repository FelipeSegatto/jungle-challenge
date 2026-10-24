FROM oven/bun:1.3.5
WORKDIR /app
COPY package.json ./
RUN bun install
COPY . .
EXPOSE 3000
CMD ["bun", "src/main.ts"]
