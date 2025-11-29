import { Prisma } from "@prisma/client";
import { prisma } from "../libs/prisma";

export async function getUserForToken(id: string) {
  return await prisma.user.findUnique({
    where: {
      id,
    },
    select: {
      id: true,
      image: true,
      name: true,
      phone: true,
      role: true,
      balance: true,
      location: true,
      lat: true,
      lng: true,
      createdAt: true,
      updatedAt: true,
      gender: true,

      car: {
        select: {
          id: true,
          status: true,
        },
      },
    },
  });
}

// export type UserToken = Awaited<ReturnType<typeof getUserForToken>>;
export type UserToken = Prisma.UserGetPayload<{
  select: {
    id: true;
    image: true;
    name: true;
    phone: true;
    role: true;
    balance: true;
    location: true;
    lat: true;
    lng: true;
    createdAt: true;
    updatedAt: true;
    gender: true;
    car: {
      select: {
        id: true;
        status: true;
      };
    };
  };
}>;
