import 'dotenv/config';
import prisma from '../lib/prisma.js';

// Assigns ALL articles in the system to a single user, identified by email.
// Usage: node src/scripts/assign-articles-to-user.js [email]
const TARGET_EMAIL = process.argv[2] || 'sahib@narangmandi.com';

async function run() {
  const user = await prisma.user.findUnique({
    where: { email: TARGET_EMAIL },
    select: { id: true, name: true, email: true },
  });

  if (!user) {
    throw new Error(`No user found with email "${TARGET_EMAIL}". Aborting — no articles changed.`);
  }

  const total = await prisma.article.count();

  const result = await prisma.article.updateMany({
    data: { authorId: user.id },
  });

  console.log(`Assigned ${result.count} of ${total} article(s) to ${user.name} <${user.email}> (id: ${user.id}).`);
}

run()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Error:', err.message);
    await prisma.$disconnect();
    process.exit(1);
  });
