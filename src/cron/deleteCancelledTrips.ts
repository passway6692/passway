import { endOfDay } from "date-fns/endOfDay";
import { startOfDay } from "date-fns/startOfDay";
import { prisma } from "../libs/prisma";

export async function deletedCancelledTrips() {
  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());

  console.log(
    `🗑️ Checking cancelled trips between ${todayStart.toISOString()} and ${todayEnd.toISOString()}`
  );

  const deleted = await prisma.trip.deleteMany({
    where: {
      status: "CANCELLED",
      

      OR: [
        { createdAt: { gte: todayStart, lte: todayEnd } },
        { updatedAt: { gte: todayStart, lte: todayEnd } },
      ],
    },
  });

  console.log(
    `✅ Deleted ${deleted.count} cancelled trips created/updated today.`
  );
}
