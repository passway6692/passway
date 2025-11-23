// scripts/expireTrips.ts
import { prisma } from "../libs/prisma";

export const cancelTrips = async () => {
  console.log("Running trip Cancellation job...");

  try {
    const today = new Date().toISOString().split("T")[0]; // "2025-11-04"

    const result = await prisma.trip.updateMany({
      where: {
        tripDates: { lt: today },
        status: { in: ["OPEN", "FULL", "ASSIGNED", "OPEN"] },
      },
      data: { status: "CANCELLED" },
    });

    console.log(`Cancelled ${result.count} trips.`);
  } catch (error) {
    console.error("Trip Cancellation job failed:", error);
  }
};
