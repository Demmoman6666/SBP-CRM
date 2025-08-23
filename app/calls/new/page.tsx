import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import CallForm from "./CallForm";

export default async function Page() {
  const reps = await prisma.salesRep.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  async function createCall(formData: FormData) {
    "use server";

    const s = (k: string) => {
      const v = String(formData.get(k) ?? "").trim();
      return v || null;
    };

    const existing = s("existing") === "yes";
    const staff = s("staff");
    const callType = s("callType");
    const summary = s("summary");
    const outcome = s("outcome");
    const followUpAtStr = s("followUpAt");
    const followUpAt = followUpAtStr ? new Date(followUpAtStr) : null;

    if (existing) {
      const customerId = s("customerId");
      if (!customerId) throw new Error("Please pick a customer from the suggestions.");
      await prisma.callLog.create({
        data: {
          isExistingCustomer: true,
          customer: { connect: { id: customerId } },
          contactName: s("contactName"),
          callType,
          summary,
          outcome,
          staff,
          followUpAt,
          followUpRequired: followUpAt ? true : false,
        },
      });
    } else {
      // New/unknown customer lead
      await prisma.callLog.create({
        data: {
          isExistingCustomer: false,
          customerName: s("new_salonName")!,           // required by the form
          contactName: s("new_contactName"),
          contactPhone: s("new_contactPhone"),
          contactEmail: s("new_contactEmail"),
          callType,
          summary,
          outcome,
          staff,
          followUpAt,
          followUpRequired: followUpAt ? true : false,
        },
      });
    }

    redirect("/"); // send them back to the homepage (or a call list if you add one)
  }

  return <CallForm reps={reps} createCall={createCall} />;
}
