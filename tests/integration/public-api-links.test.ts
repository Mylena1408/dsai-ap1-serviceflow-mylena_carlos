import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./fixtures";

vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { generateApiToken } from "@/modules/api-tokens";
import { loadDemoData } from "@/modules/demo";
import { getRequest } from "@/modules/public-api";

// SPEC 2026-11-07-operacao-e-automacao, 3.3 item 1 (SF-176; CA-VNC-03 through the API): the detail
// carries the links as the screens show them.

async function tokenFor(email: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const token = generateApiToken();
  const now = new Date();
  await prisma.apiToken.create({
    data: { userId: user.id, name: "links", scope: "READ", tokenHash: token.hash, lastFour: token.lastFour, createdAt: now, expiresAt: new Date(now.getTime() + 86_400_000) },
  });
  return token.value;
}

async function detail(requestId: string, token: string) {
  const response = await getRequest(
    new Request(`https://serviceflow.test/api/v1/requests/${requestId}`, { headers: { authorization: `Bearer ${token}` } }),
    { params: Promise.resolve({ requestId }) },
  );
  return {
    status: response.status,
    body: (await response.json()) as {
      links: Array<{ relation: string; request: { id: string; accessible: boolean } }>;
      group: { name: string; total: number; otherRequests: Array<{ id: string; accessible: boolean }> } | null;
    },
  };
}

describe("links in the API detail (SF-176)", () => {
  beforeEach(async () => {
    await loadDemoData(prisma);
  });

  it("the attendant sees every link; the requester only links between their own requests", async () => {
    const diego = await prisma.user.findUniqueOrThrow({ where: { email: "diego.rocha@exemplo.test" } });
    const sectorRequests = await prisma.request.findMany({ where: { sectorId: diego.sectorId! }, orderBy: { id: "asc" }, take: 3 });
    expect(sectorRequests.length).toBe(3);
    const [first, second, third] = sectorRequests;
    // The third request belongs to another requester, so its requester never sees the link to the first.
    const other = await prisma.user.findFirstOrThrow({ where: { role: "REQUESTER", id: { not: first.requesterId } } });
    await prisma.request.update({ where: { id: third.id }, data: { requesterId: other.id } });
    await prisma.request.update({ where: { id: second.id }, data: { requesterId: first.requesterId } });

    // The links are written as the use case writes them (its rules are covered in request-links.test.ts).
    const at = new Date();
    await prisma.requestLink.create({ data: { fromRequestId: first.id, toRequestId: second.id, kind: "DUPLICATE_OF", createdById: diego.id, createdAt: at } });
    await prisma.requestLink.create({ data: { fromRequestId: first.id, toRequestId: third.id, kind: "RELATED", createdById: diego.id, createdAt: new Date(at.getTime() + 1) } });

    const asAttendant = await detail(first.id, await tokenFor("diego.rocha@exemplo.test"));
    expect(asAttendant.status).toBe(200);
    expect(asAttendant.body.links.map(({ relation, request }) => [relation, request.id, request.accessible])).toEqual([
      ["duplicate_of", second.id, true],
      ["related", third.id, true],
    ]);

    const requester = await prisma.user.findUniqueOrThrow({ where: { id: first.requesterId } });
    const asRequester = await detail(first.id, await tokenFor(requester.email));
    expect(asRequester.status).toBe(200);
    expect(asRequester.body.links.map(({ relation, request }) => [relation, request.id])).toEqual([["duplicate_of", second.id]]);
  });

  it("a request without links has an empty list", async () => {
    const diego = await prisma.user.findUniqueOrThrow({ where: { email: "diego.rocha@exemplo.test" } });
    const request = await prisma.request.findFirstOrThrow({ where: { sectorId: diego.sectorId! } });
    const response = await detail(request.id, await tokenFor("diego.rocha@exemplo.test"));
    expect(response.body.links).toEqual([]);
  });

  it("carries the bundle and its other requests, and null outside bundles (SF-179)", async () => {
    const diego = await prisma.user.findUniqueOrThrow({ where: { email: "diego.rocha@exemplo.test" } });
    const [first, second] = await prisma.request.findMany({ where: { sectorId: diego.sectorId! }, orderBy: { id: "asc" }, take: 2 });
    await prisma.request.update({ where: { id: second.id }, data: { requesterId: first.requesterId } });
    const group = await prisma.requestGroup.create({ data: { bundleNameSnapshot: "Admissão", requesterId: first.requesterId, createdAt: new Date() } });
    await prisma.request.update({ where: { id: first.id }, data: { groupId: group.id, groupPosition: 1 } });
    await prisma.request.update({ where: { id: second.id }, data: { groupId: group.id, groupPosition: 2 } });

    const response = await detail(first.id, await tokenFor("diego.rocha@exemplo.test"));
    expect(response.body.group).toMatchObject({ name: "Admissão", total: 2, otherRequests: [{ id: second.id, accessible: true }] });
    const outside = await prisma.request.findFirstOrThrow({ where: { sectorId: diego.sectorId!, groupId: null } });
    expect((await detail(outside.id, await tokenFor("diego.rocha@exemplo.test"))).body.group).toBeNull();
  });
});
