import { Response } from "express";
import { prisma } from "../libs/prisma";
import { FullRequest } from "../types/request";
import { sendNotificationWithDelay } from "../utils/sendNotification";
import { tr } from "zod/v4/locales";

export const addReview = async (req: FullRequest, res: Response) => {
  try {
    const { tripId, rating, description } = req.body;
    const userId = req.user?.id;

    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    if (!tripId || !rating)
      return res.status(400).json({ message: "Trip ID and rating are required" });

    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      include: { driver: true, creator: true },
    });
    if (!trip) return res.status(404).json({ message: "Trip not found" });


    if (trip.driverId !== userId) {
      const member = await prisma.tripMember.findFirst({ where: { tripId, userId } });
      if (!member) return res.status(403).json({ message: "You are not part of this trip" });
    }

    const existingReview = await prisma.tripReview.findFirst({
      where: { tripId, userId }
    });
    if (existingReview)
      return res.status(400).json({ message: "You already reviewed this trip" });


    const review = await prisma.tripReview.create({
      data: { tripId, userId, rating, description },
      include: {
        user: { select: { id: true, name: true, image: true } },
        trip: { select: { id: true, from: true, to: true, startTime: true, status: true } },
      },
    });


    let otherUserId = trip.driverId === userId ? trip.creatorId : trip.driverId;


    if (otherUserId) {
      const allReviews = await prisma.tripReview.findMany({
        where: { userId: otherUserId }
      });

      const avgRating =
        allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length;

      await prisma.user.update({
        where: { id: otherUserId },
        data: { averageRating: avgRating },
      });

      sendNotificationWithDelay(
        otherUserId,
        "تم تقييمك ⭐",
        `${req.user?.name || "مستخدم"} قام بتقييمك في الرحلة`,
        2000
      );
    }

    res.json({
      message: "Review added successfully",
      review: {
        id: review.id,
        rating: review.rating,
        description: review.description,
        createdAt: review.createdAt,
        user: review.user,
        trip: review.trip,
      },
    });

  } catch (error: any) {
    console.error("Error adding review:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
};


export const getTripReviews = async (req: FullRequest, res: Response) => {
  try {
    const { tripId } = req.params;

    const reviews = await prisma.tripReview.findMany({
      where: { tripId },
      include: { user: { select: { id: true, name: true, image: true, role: true,averageRating :true } } },
      orderBy: { createdAt: "desc" },
    });

    res.json({
      tripId,
      reviewsCount: reviews.length,
      reviews,
    });
  } catch (error) {
    console.error("Error getting trip reviews:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const getUserReviews = async (req: FullRequest, res: Response) => {
  try {
    const { userId } = req.params;

    const reviews = await prisma.tripReview.findMany({
      where: { userId },
      include: {
        trip: { select: { id: true, from: true, to: true, startTime: true, status: true } },
        user: { select: { id: true, name: true, phone: true,image :true ,averageRating:true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const reviewedUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, phone: true,image :true ,averageRating:true},
    });
    const avg = await prisma.tripReview.aggregate({
      where: { userId },
      _avg: { rating: true },
    });

    res.json({
      user: reviewedUser,
      averageRating: avg._avg.rating ?? 0,
      reviewsCount: reviews.length,
      reviews: reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        description: r.description,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        trip: r.trip,
        reviewer: r.user,
      })),
    });
  } catch (error) {
    console.error("Error getting user reviews:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

