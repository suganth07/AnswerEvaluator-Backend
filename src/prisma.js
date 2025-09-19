const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  },
  // Configure connection and query timeouts
  __internal: {
    engine: {
      connectTimeout: 60000,    // 60 seconds to establish connection
      requestTimeout: 120000,   // 2 minutes for query timeout
    }
  }
});

// Handle connection errors and graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

// Add connection retry logic
const connectWithRetry = async () => {
  let retries = 5;
  while (retries > 0) {
    try {
      await prisma.$connect();
      console.log('✅ Database connected successfully');
      break;
    } catch (error) {
      console.error(`❌ Database connection failed. Retries left: ${retries - 1}`);
      retries--;
      if (retries === 0) {
        console.error('❌ Could not connect to database after 5 attempts');
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds before retry
    }
  }
};

// Initialize connection
connectWithRetry().catch(console.error);

module.exports = prisma;