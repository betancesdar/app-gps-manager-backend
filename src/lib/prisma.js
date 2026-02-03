/**
 * Prisma Client Singleton
 * Ensures single database connection across the application
 */

const { PrismaClient } = require('@prisma/client');

// Global variable to store prisma instance (for development hot reload)
const globalForPrisma = globalThis;

const prisma = globalForPrisma.prisma ?? new PrismaClient({
    log: process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
});

if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prisma;
}

/**
 * Connect to database with retry logic
 * @param {number} maxRetries - Maximum retry attempts
 * @param {number} delayMs - Delay between retries in milliseconds
 */
async function connectDatabase(maxRetries = 5, delayMs = 3000) {
    let retries = 0;

    while (retries < maxRetries) {
        try {
            await prisma.$connect();
            console.log('✅ Connected to PostgreSQL database');
            return true;
        } catch (error) {
            retries++;
            console.error(`❌ Database connection failed (attempt ${retries}/${maxRetries}):`, error.message);

            if (retries < maxRetries) {
                console.log(`⏳ Retrying in ${delayMs / 1000} seconds...`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }
    }

    throw new Error('Failed to connect to database after maximum retries');
}

/**
 * Disconnect from database (for graceful shutdown)
 */
async function disconnectDatabase() {
    await prisma.$disconnect();
    console.log('🔌 Disconnected from PostgreSQL database');
}

module.exports = {
    prisma,
    connectDatabase,
    disconnectDatabase
};
