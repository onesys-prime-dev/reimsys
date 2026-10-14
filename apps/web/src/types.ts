import type { ReceiptAction, ReceiptStatus } from '@reimsys/shared';

export interface ReceiptBrief {
  id: number;
  refNo: string;
  status: ReceiptStatus;
  version: number;
  payee: string;
  receiptDate: string;
  amount: number;
  invoiceNo: string | null;
  transactionType: 'product' | 'service' | null;
  birInvoice: boolean | null;
  /** Only receipts made before the client form have one. */
  category: { id: number; name: string } | null;
  encoder: { id: number; name: string };
  submittedAt: string | null;
  checkedAt: string | null;
  updatedAt: string;
  docNo: string | null;
}

export interface EvidenceFile { id: number; fileName: string; mime: string; size: number; createdAt: string }

export interface ReceiptForm {
  birInvoice: boolean | null; seenCompany: boolean | null; seenTin: boolean | null; seenAddress: boolean | null; noBirReason: string | null;
  invoiceNo: string | null; vendorAddress: string | null; vendorTin: string | null; transactionType: string | null;
  vatType: string | null; vatableAmount: number | null; vatAmount: number | null;
  withheld: boolean | null; whtRate: number | null; whtAmount: number | null;
  /** What the Checker confirmed can be seen on the invoice. Null until a check was made. */
  checked: { company: boolean | null; tin: boolean | null; address: boolean | null } | null;
}

export interface ReceiptDetail extends ReceiptBrief {
  description: string | null;
  form: ReceiptForm;
  warnings: string[];
  checkedBy: string | null; checkedAt: string | null; checkNote: string | null;
  decidedBy: string | null; decidedAt: string | null; decisionNote: string | null;
  lastNote: string | null;
  createdAt: string;
  isOwner: boolean;
  canEdit: boolean;
  canCopy: boolean;
  canDelete: boolean;
  undoUntil: string | null;
  possibleDuplicates: { id: number; refNo: string; status: ReceiptStatus; encoder: string }[];
  actions: { action: ReceiptAction; note: 'none' | 'optional' | 'required' }[];
  evidence: EvidenceFile[];
  document: { id: number; docNo: string; status: string } | null;
}

export interface Category { id: number; name: string; isActive: boolean; receiptCount?: number }
export interface HistoryItem { id: number; actor: string; action: string; summary: string | null; note: string | null; createdAt: string }

export interface CommentItem { id: number; body: string; createdAt: string; author: { id: number; name: string }; mine: boolean }
