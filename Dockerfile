# Use Node.js LTS Alpine image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

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