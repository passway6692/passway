import { prisma } from "../libs/prisma";

export async function checkDriverHasConflictingTrip(
  driverId: string,
  proposedStart: Date
): Promise<boolean> {
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000; // 2 hours in milliseconds

  const trips = await prisma.trip.findMany({
    where: {
      driverId,
      status: "ASSIGNED",
      isPaid: false,
    },
    select: {
      startTime: true,
    },
  });

  const proposedStartMs = proposedStart.getTime();

  for (const trip of trips) {
    const tripStartMs = new Date(trip.startTime).getTime();

    // Conflict if any assigned trip starts within ±2 hours of proposed start
    if (Math.abs(tripStartMs - proposedStartMs) < TWO_HOURS_MS) {
      return true;
    }
  }

  return false;
}
