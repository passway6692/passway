import { BookingType, TripStatus } from "@prisma/client";
import { prisma } from "../libs/prisma";

interface TripData {
  from: string;
  to: string;
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  startTime: string;
  endTime: string;

  seatsRequested: number;
  tripDates: string;
  bookingType: BookingType;
  status?: string;
}

interface CreateTripParams {
  tripData: TripData;
  userId: string;
  passengerFare: number;
  totalFare: number;
  driverShare: number;
  appCommission: number;
  pickupLat: number;
  pickupLng: number;
  dropLat: number;
  dropLng: number;
  status?: TripStatus;
  distance: number; //
  duration: number; //
  userHasEnoughMoney: boolean;
}

export async function createTrip({
  tripData,
  userId,
  passengerFare,
  totalFare,
  driverShare,
  appCommission,
  pickupLat,
  pickupLng,
  dropLat,
  dropLng,
  status,
  distance,
  duration,
  userHasEnoughMoney,
}: CreateTripParams) {
  return prisma.$transaction(async (tx) => {
    const trip = await tx.trip.create({
      data: {
        creatorId: userId,
        from: tripData.from,
        to: tripData.to,
        fromLat: tripData.fromLat,
        fromLng: tripData.fromLng,
        toLat: tripData.toLat,
        toLng: tripData.toLng,
        startTime: tripData.startTime,
        endTime: tripData.endTime,
        seatsRequested: tripData.seatsRequested,
        tripDates: tripData.tripDates,
        bookingType: tripData.bookingType,
        userHasEnoughMoney,
        status:
          status ??
          (tripData.bookingType === "SINGLE" ||
          tripData.bookingType === "DOUBLE" ||
          (tripData.bookingType === "TRIPLE" && tripData.seatsRequested === 3)
            ? "FULL"
            : "OPEN"),
        totalFare,
        driverShare,
        appCommission,
        distance,
        duration,
      },
      include: {
        members: true,
      },
    });
    const member = await tx.tripMember.create({
      data: {
        tripId: trip.id,
        userId,
        passengerFare,
        pickupLat,
        pickupLng,
        dropLat,
        dropLng,
        seatsBooked: tripData.seatsRequested,
      },
    });
    return { trip, member };
  });
}
