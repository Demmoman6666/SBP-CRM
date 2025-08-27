// lib/auth.ts
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export async function getCurrentUser() {
  const id =
    cookies().get("sbp_uid")?.value ||
    cookies().get("sbp_user_id")?.value ||
    null;
  if (!id) return null;
  return prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      fullName: true,
      phone: true,
      role: true,
      features: true,
    },
  });
}
