# Use Node.js LTS with full image (not Alpine) for better PDF/image processing compatibility
FROM node:18-slim

# Install system dependencies for PDF processing and sharp
RUN apt-get update && apt-get install -y \
    curl \
    graphicsmagick \
    ghostscript \
    poppler-utils \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies (use npm install to handle lock file differences)
RUN npm install --omit=dev

# Copy application code (excluding node_modules)
COPY src ./src
COPY services ./services
COPY prisma ./prisma
COPY .env* ./

# Generate Prisma client
RUN npx prisma generate

# Expose port
EXPOSE 4659

# Health check
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:4659/health || exit 1

# Start the application
CMD ["npm", "start"]