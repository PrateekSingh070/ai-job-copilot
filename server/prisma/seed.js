import bcrypt from "bcryptjs";
// Reuse the app's client so the seed gets the same validated env loading.
// Building a second client here meant a missing DATABASE_URL silently became
// an empty connection string instead of a readable startup error.
import { prisma } from "../src/db/prisma.js";

// Seeds one demo user plus a few applications so the dashboard has data.
// Safe to run more than once: the user is upserted and jobs are only added
// when the user has none.

async function main() {
  const passwordHash = await bcrypt.hash("DemoPass123!", 12);
  const user = await prisma.user.upsert({
    where: { email: "demo@copilot.local" },
    update: {},
    create: { name: "Demo User", email: "demo@copilot.local", passwordHash },
  });

  const existingJobs = await prisma.jobApplication.count({
    where: { userId: user.id },
  });
  if (existingJobs === 0) {
    await prisma.jobApplication.createMany({
      data: [
        {
          userId: user.id,
          company: "Acme Labs",
          role: "Frontend Engineer Intern",
          status: "APPLIED",
          location: "Remote",
        },
        {
          userId: user.id,
          company: "Nova Systems",
          role: "Full Stack Developer",
          status: "INTERVIEW",
          location: "Bengaluru",
        },
        {
          userId: user.id,
          company: "Vertex Cloud",
          role: "Backend Engineer",
          status: "OFFER",
          location: "Hyderabad",
        },
      ],
    });
  }
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
