# ─────────────────────────────────────────────────────────────────────────────
# BimmerERP — multi-stage production image (Next.js standalone output)
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS base
# openssl is required by the Prisma query engine on Alpine.
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

# ── Dependencies ─────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci

# ── Build ────────────────────────────────────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Generate the Prisma client against the real schema before compiling.
RUN npx prisma generate
ENV NEXT_TELEMETRY_DISABLED=1
# next.config.mjs only emits `output: "standalone"` when this is set, so the
# default (Vercel) build stays serverless-compatible while this self-hosted
# image still gets the standalone bundle copied below.
ENV NEXT_OUTPUT_STANDALONE=1
RUN npm run build

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Standalone output already contains the minimal node_modules subset.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Prisma schema, engines and the seed script for `docker compose exec`.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:3000,path:'/api/health',timeout:4000},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
