import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const databaseUrl = process.env.DATABASE_URL ?? "";
const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

async function main() {
  const passwordHash = await bcrypt.hash("DemoPass123!", 12);
  const user = await prisma.user.upsert({
    where: { email: "demo@copilot.local" },
    update: {},
    create: {
      name: "Demo User",
      email: "demo@copilot.local",
      passwordHash,
    },
  });

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
    ],
    skipDuplicates: true,
  });
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
