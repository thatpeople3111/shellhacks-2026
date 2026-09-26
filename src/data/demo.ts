import type { TripRequest } from "@/lib/types";
export const demoTripRequest: TripRequest = {
  origin: "FIU Modesto A. Maidique Campus, Miami, FL",
  destination: "Wynwood Walls, Miami, FL",
  budget: 15,
  maxWalkingMinutes: 10,
  hasCar: true,
  preference: "balanced",
  allowTransit: true,
  allowWalking: true,
};
