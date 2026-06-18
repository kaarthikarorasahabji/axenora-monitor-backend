FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy source code, migration assets, scripts, and the downloadable installer
COPY src/ ./src/
COPY db/ ./db/
COPY scripts/ ./scripts/
COPY dist/ ./dist/

# Create uploads directory
RUN mkdir -p uploads

# HF Spaces expects port 7860
EXPOSE 7860

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:7860/api/health || exit 1

ENV NODE_ENV=production
ENV PORT=7860

# Start the application
CMD ["node", "src/server.js"]
