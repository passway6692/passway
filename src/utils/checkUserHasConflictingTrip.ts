import { prisma } from "../libs/prisma";
import { combineDateAndTime } from "../utils/combineDateAndTime";
export async function checkUserHasConflictingTrip(
  userId: string,
  proposedStart: Date,
  proposedEnd?: Date
) {
  const TWO_HOURS = 2 * 60 * 60 * 1000; 

  const members = await prisma.tripMember.findMany({
    where: {
      userId,
      trip: {
        status: { notIn: ["CANCELLED", "COMPLETED"] },
      },
    },
    select: {
      trip: {
        select: { startTime: true, endTime: true },
      },
    },
  });

  for (const member of members) {
const tripStart = new Date(member.trip.startTime).getTime();
const tripEnd = member.trip.endTime
  ? new Date(member.trip.endTime).getTime()
  : tripStart + TWO_HOURS;

const proposedStartMs = proposedStart.getTime();
const proposedEndMs = proposedEnd ? proposedEnd.getTime() : proposedStartMs + TWO_HOURS;



    if (Math.abs(tripStart - proposedStartMs) < TWO_HOURS) {
      return true;
    }
    if (proposedEnd && (
      (proposedStartMs >= tripStart && proposedStartMs < tripEnd) ||
      (proposedEndMs > tripStart && proposedEndMs <= tripEnd) ||
      (proposedStartMs <= tripStart && proposedEndMs >= tripEnd)
    )) {
      return true;
    }
  }

  return false;
}


export async function checkMultipleTripConflicts(
  userId: string,
  tripDates: string[],
  startTime: string,
  duration: number
) {
  for (const dateStr of tripDates) {
    const startDate = combineDateAndTime(dateStr, startTime);
    const endDate = new Date(startDate.getTime() + duration * 1000);
    
    const hasConflict = await checkUserHasConflictingTrip(
      userId, 
      startDate, 
      endDate
    );
    
    if (hasConflict) {
      return true;
    }
  }
  
  return false;
}