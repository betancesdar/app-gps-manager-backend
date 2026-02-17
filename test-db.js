require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

// Override DATABASE_URL to use 127.0.0.1
process.env.DATABASE_URL = 'postgresql://gps_user:gps_password@127.0.0.1:5432/gps_mock_db';

const prisma = new PrismaClient({
    log: ['query', 'error', 'warn', 'info'],
});

async function test() {
    try {
        console.log('Testing connection to:', process.env.DATABASE_URL);
        await prisma.$connect();
        console.log('✅ Connection successful!');

        const count = await prisma.user.count();
        console.log(`Users in database: ${count}`);

        await prisma.$disconnect();
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

test();
