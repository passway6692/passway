import { Request, Response } from "express";
import { firebaseDB } from "../libs/firebase";
import { prisma } from "../libs/prisma";

export async function updateDriverLocation(req: Request, res: Response) {
  try {
    const { lat, lng } = req.body;
    const tripId = req.params.tripId;
    const driverId = (req as any).user?.id;

    if (!lat || !lng) {
      return res.status(400).json({ error: "Missing lat or lng" });
    }

    if (!tripId || !driverId) {
      return res.status(400).json({ error: "Missing tripId or driverId" });
    }

    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      select: { driverId: true },
    });

    if (!trip) {
      return res.status(404).json({ error: "Trip not found" });
    }

    if (trip.driverId !== driverId) {
      return res
        .status(403)
        .json({ error: "You are not the driver for this trip" });
    }

    await firebaseDB.ref(`trips/${tripId}`).update({
      driverLocation: { lat, lng },
      updatedAt: Date.now(),
    });

    return res.status(200).json({
      success: true,
      message: "Driver location updated successfully",
    });
  } catch (error) {
    console.error("Error updating driver location:", error);
    return res.status(500).json({ error: "Server error" });
  }
}

export async function getDriverLocation(req: Request, res: Response) {
  try {
    const tripId = req.params.tripId;

    if (!tripId) {
      return res.status(400).json({ error: "Missing tripId" });
    }

    const snapshot = await firebaseDB
      .ref(`trips/${tripId}/driverLocation`)
      .once("value");

    if (!snapshot.exists()) {
      return res.status(404).json({ error: "Driver location not found" });
    }

    const driverLocation = snapshot.val();

    return res.status(200).json({
      success: true,
      driverLocation: {
        lat: driverLocation.lat,
        lng: driverLocation.lng,
      },
    });
  } catch (error) {
    console.error("Error fetching driver location:", error);
    return res.status(500).json({ error: "Server error" });
  }
}

export async function updatePassengerLocation(req: Request, res: Response) {
  try {
    const { lat, lng } = req.body;
    const tripId = req.params.tripId;
    const passengerId = (req as any).user?.id;

    if (!lat || !lng) {
      return res.status(400).json({ error: "Missing lat or lng" });
    }

    if (!tripId || !passengerId) {
      return res.status(400).json({ error: "Missing tripId or passengerId" });
    }

    await firebaseDB
      .ref(`trips/${tripId}/passengersLocations/${passengerId}`)
      .update({
        lat,
        lng,
        updatedAt: Date.now(),
      });

    return res.status(200).json({
      success: true,
      message: "Passenger location updated successfully",
    });
  } catch (error) {
    console.error("Error updating passenger location:", error);
    return res.status(500).json({ error: "Server error" });
  }
}

export async function getPassengersLocations(req: Request, res: Response) {
  try {
    const tripId = req.params.tripId;

    if (!tripId) {
      return res.status(400).json({ error: "Missing tripId" });
    }

    const snapshot = await firebaseDB
      .ref(`trips/${tripId}/passengersLocations`)
      .once("value");

    if (!snapshot.exists()) {
      return res.status(200).json({
        success: true,
        passengersLocations: {},
      });
    }

    const passengersLocations = snapshot.val();

    return res.status(200).json({
      success: true,
      passengersLocations: passengersLocations || {},
    });
  } catch (error) {
    console.error("Error fetching passengers locations:", error);
    return res.status(500).json({ error: "Server error" });
  }
}

export async function updatePassengerStatus(req: Request, res: Response) {
  try {
    const { memberId, pickupStatus, dropStatus } = req.body;
    const tripId = req.params.tripId;
    const driverId = (req as any).user?.id;

    if (!memberId || !pickupStatus || !dropStatus) {
      return res.status(400).json({ error: "Missing memberId, pickupStatus, or dropStatus" });
    }

    if (!tripId || !driverId) {
      return res.status(400).json({ error: "Missing tripId or driverId" });
    }

    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      select: { driverId: true },
    });

    if (!trip) {
      return res.status(404).json({ error: "Trip not found" });
    }

    if (trip.driverId !== driverId) {
      return res
        .status(403)
        .json({ error: "You are not the driver for this trip" });
    }

    await firebaseDB.ref(`trips/${tripId}/passengersStatuses/${memberId}`).update({
      pickupStatus,
      dropStatus,
      updatedAt: Date.now(),
    });

    return res.status(200).json({
      success: true,
      message: "Passenger status updated successfully",
    });
  } catch (error) {
    console.error("Error updating passenger status:", error);
    return res.status(500).json({ error: "Server error" });
  }
}

export async function getPassengerStatuses(req: Request, res: Response) {
  try {
    const tripId = req.params.tripId;

    if (!tripId) {
      return res.status(400).json({ error: "Missing tripId" });
    }

    const snapshot = await firebaseDB
      .ref(`trips/${tripId}/passengersStatuses`)
      .once("value");

    if (!snapshot.exists()) {
      return res.status(200).json({
        success: true,
        passengersStatuses: {},
      });
    }

    const passengersStatuses = snapshot.val();

    return res.status(200).json({
      success: true,
      passengersStatuses: passengersStatuses || {},
    });
  } catch (error) {
    console.error("Error fetching passengers statuses:", error);
    return res.status(500).json({ error: "Server error" });
  }
}