export type RequestStatus = "OPEN" | "IN_PROGRESS" | "COMPLETED";

export interface RequestRecord {
  id: string;
  requesterId: string;
  serviceId: string;
  sectorId: string;
  serviceNameSnapshot: string;
  serviceDescriptionSnapshot: string;
  categoryIdSnapshot: string;
  categoryNameSnapshot: string;
  sectorNameSnapshot: string;
  description: string;
  status: RequestStatus;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface RequestStatusEventRecord {
  id: string;
  requestId: string;
  actorId: string;
  fromStatus: RequestStatus | null;
  toStatus: RequestStatus;
  occurredAt: Date;
  actor: {
    id: string;
    name: string;
    email: string;
  };
}

export interface RequestWithHistory extends RequestRecord {
  events: RequestStatusEventRecord[];
  service: {
    id: string;
    isActive: boolean;
  };
}

export type RequestSummary = Pick<
  RequestRecord,
  | "id"
  | "status"
  | "description"
  | "createdAt"
  | "updatedAt"
  | "completedAt"
  | "serviceNameSnapshot"
  | "serviceDescriptionSnapshot"
  | "categoryNameSnapshot"
  | "sectorNameSnapshot"
>;
