import type { BatchStep, CutoffRule, CutoffState, ReceiptAction, ReceiptStatus, ReturnIssueCode, TaxImpact } from '@reimsys/shared';

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
  /** closedAt, cutoffAt and cutoffDoneAt say whether a late addition could move it out of that batch. */
  batch: { id: number; code: string; name: string | null; closedAt?: string | null; cutoffAt?: string | null; cutoffDoneAt?: string | null } | null;
  /** Added to its batch after the batch closed or its cutoff ran, and why. */
  batchLateAt: string | null;
  batchLateNote: string | null;
  /** A draft's chosen batch: it joins when submitted. */
  wantBatch: { id: number; code: string; name: string | null } | null;
}

export interface EvidenceFile { id: number; fileName: string; mime: string; size: number; createdAt: string }

export interface ReceiptForm {
  birInvoice: boolean | null; invoiceUnderCompany: boolean | null; reasonForSpending: string | null; classification: string | null; classificationOther: string | null; seenCompany: boolean | null; seenTin: boolean | null; seenAddress: boolean | null; noBirReason: string | null;
  invoiceNo: string | null; vendorAddress: string | null; vendorTin: string | null; transactionType: string | null;
  vatType: string | null; vatableAmount: number | null; vatAmount: number | null; vatExemptAmount: number | null; discountAmount: number | null;
  chargeLocation: { id: number; name: string } | null;
  withheld: boolean | null; whtRate: number | null; whtAmount: number | null;
  /** What the Checker confirmed can be seen on the invoice. Null until a check was made. */
  checked: { company: boolean | null; tin: boolean | null; address: boolean | null } | null;
}

export interface ReceiptDetail extends ReceiptBrief {
  description: string | null;
  form: ReceiptForm;
  warnings: string[];
  impact: TaxImpact;
  incompleteReasons: string[];
  checkedBy: string | null; checkedAt: string | null; checkNote: string | null;
  decidedBy: string | null; decidedAt: string | null; decisionNote: string | null;
  lastNote: string | null;
  returnIssues: ReturnIssueCode[];
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
  payment: PaymentInfo | null;
}

export interface Category { id: number; name: string; isActive: boolean; receiptCount?: number }
export interface HistoryItem {
  id: number; actor: string; action: string; summary: string | null; note: string | null; createdAt: string;
  /** On "marked as paid" entries: that payment, whether it was later reversed, and whether this person may open its proof. */
  payment?: { id: number; paymentNo: string; reversed: boolean; canOpenProof: boolean };
}

export interface CommentItem { id: number; body: string; createdAt: string; author: { id: number; name: string }; mine: boolean }

export interface PaymentInfo {
  id: number; paymentNo: string; method: string; paidOn: string; amount: number; shortReason: string | null;
  recordedBy: string; recordedAt: string | null; proof: { mime: string; size: number };
}
export interface PaymentQueue {
  groups: { payee: { id: number; name: string; branch: string | null }; count: number; total: number; receipts: ReceiptBrief[] }[];
  batches: { id: number; code: string; name: string | null; count: number; people: number; total: number }[];
  totals: { count: number; total: number };
}

export type { BatchStep };
interface BatchHead {
  id: number; code: string; name: string | null; closed: boolean; closedAt: string | null; createdAt: string; createdBy: { id: number; name: string }; count: number; total: number; counts: Record<string, number>;
  cutoffAt: string | null; cutoffState: CutoffState; timeZone: string; schedule: { id: number; name: string; isOn: boolean } | null; part: number;
}
export interface BatchCutoff {
  at: string | null; state: CutoffState; timeZone: string; running: boolean; doneAt: string | null; rule: CutoffRule | null; ruleText: string | null;
  canChange: boolean; canRemove: boolean; canRun: boolean;
}
export interface BatchSummary extends BatchHead { waiting: Partial<Record<BatchStep, number>> }
export interface BatchDetail extends BatchHead {
  /** Receipts in the batch at a step this person cannot see. */
  hidden: number;
  canManage: boolean;
  steps: BatchStep[];
  ready: Partial<Record<BatchStep, number>>;
  receipts: (ReceiptBrief & { readyFor: BatchStep | null; canRemove: boolean })[];
  payable: { id: number; refNo: string; vendor: string; amount: number; version: number; person: string; personId: number }[];
  cutoff: BatchCutoff | null;
  canSetCutoff: boolean;
  canUseInProgress: boolean;
  /** What the cutoff would take if it ran now; hidden = how many of those are at steps this person does not see. */
  wouldAdd: { count: number; total: number; hidden: number } | null;
  /** Closed or cut off: what is added now is late. */
  late: boolean;
  lateCount: number;
  canAddLate: boolean;
  /** Drafts whose Med Ref chose this batch; they join when submitted. */
  waitingDrafts: number;
  parts: { id: number; code: string }[];
  partOf: { id: number; code: string } | null;
}
