import { prisma } from "../libs/prisma";

interface FareBreakdown {
  passengerFare: number;
  driverShare: number;
  appCommission: number;
}

export async function calculateFarePerPassenger(
  distanceKm: number,
  seatsRequested: number = 1,
  bookingType: "SINGLE" | "DOUBLE" | "TRIPLE" = "TRIPLE"
): Promise<FareBreakdown> {
  const setting = await prisma.bookingTypeSetting.findUnique({
    where: { bookingType },
  });

  if (!setting) {
    throw new Error(`BookingTypeSetting not found for ${bookingType}`);
  }

  const baseFare = setting.baseFare;
  const perKmRate = setting.perKmRate;


  const appSetting = await prisma.setting.findFirst();
  const appCommissionRate = appSetting?.appCommission ?? 0.1;

  const passengerFare = Math.ceil((baseFare + distanceKm * perKmRate) * seatsRequested);
  const appCommissionAmount = Math.ceil(passengerFare * appCommissionRate);
  const driverShare = passengerFare - appCommissionAmount;

  return {
    passengerFare,
    driverShare,
    appCommission: appCommissionAmount,
  };
}
