export type DocumentFormat = "PDF" | "DOCX" | "TXT";

export interface DocumentRequirementRecord {
  id: string;
  serviceId: string;
  name: string;
  isRequired: boolean;
  acceptedFormats: DocumentFormat[];
  position: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DocumentRequirementData {
  name: string;
  isRequired: boolean;
  acceptedFormats: DocumentFormat[];
}
