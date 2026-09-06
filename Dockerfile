# Multi-stage production build for Node.js 20
FROM node:20-alpine

# Install curl, ffmpeg, and ca-certificates for stream processing
RUN apk add --no-cache ffmpeg curl bash

WORKDIR /app

# Copy package descriptors first to leverage layer caching
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Copy project source files
COPY . .

# Ensure upload/cache/db directories exist
RUN mkdir -p data downloads hls cdn

# Expose default API & Web port
EXPOSE 3000

ENV PORT=3000 \
    NODE_ENV=production

# Start production server
CMD ["node", "server.js"]
