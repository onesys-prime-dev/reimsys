import type { ReceiptAction, ReceiptStatus } from '@reimsis/shared';

export interface ReceiptBrief {
  id: number;
  refNo: string;
  status: ReceiptStatus;
  version: number;
  payee: string;
  receiptDate: string;
  amount: number;
  category: { id: number; name: string };
  encoder: { id: number; name: string };
  submittedAt: string | null;
  checkedAt: string | null;
  updatedAt: string;
  docNo: string | null;
}

export interface EvidenceFile { id: number; fileName: string; mime: string; size: number; createdAt: string }

export interface ReceiptDetail extends ReceiptBrief {
  description: string | null;
  checkedBy: string | null; checkedAt: string | null; checkNote: string | null;
  decidedBy: string | null; decidedAt: string | null; decisionNote: string | null;
  lastNote: string | null;
  createdAt: string;
  isOwner: boolean;
  canEdit: boolean;
  canCopy: boolean;
  actions: { action: ReceiptAction; note: 'none' | 'optional' | 'required' }[];
  evidence: EvidenceFile[];
  document: { id: number; docNo: string; status: string } | null;
}

export interface Category { id: number; name: string; isActive: boolean; receiptCount?: number }
export interface HistoryItem { id: number; actor: string; action: string; summary: string | null; note: string | null; createdAt: string }
