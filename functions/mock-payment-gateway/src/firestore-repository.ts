import { Firestore } from '@google-cloud/firestore';
import { PaymentRecord, PaymentRepository, RefundResult } from './repository';

const ALREADY_EXISTS = 6;

/** Firestore collection `payments`, one document per payment, keyed by paymentId. */
export class FirestorePaymentRepository implements PaymentRepository {
  private readonly db: Firestore;

  constructor(projectId: string) {
    this.db = new Firestore({ projectId });
  }

  private doc(paymentId: string) {
    return this.db.collection('payments').doc(paymentId);
  }

  async create(payment: PaymentRecord) {
    try {
      await this.doc(payment.paymentId).create(payment);
      return { payment, created: true };
    } catch (err) {
      if ((err as { code?: number }).code !== ALREADY_EXISTS) throw err;
      const existing = await this.get(payment.paymentId);
      return { payment: existing ?? payment, created: false };
    }
  }

  async get(paymentId: string) {
    const snap = await this.doc(paymentId).get();
    return snap.exists ? (snap.data() as PaymentRecord) : null;
  }

  complete(paymentId: string, outcome: 'APPROVED' | 'DECLINED') {
    const ref = this.doc(paymentId);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const p = snap.data() as PaymentRecord;
      if (p.status !== 'CREATED') return p;
      tx.update(ref, { status: outcome });
      return { ...p, status: outcome };
    });
  }

  refund(paymentId: string, refundId: string): Promise<RefundResult> {
    const ref = this.doc(paymentId);
    return this.db.runTransaction(async (tx): Promise<RefundResult> => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { kind: 'not_found' };
      const p = snap.data() as PaymentRecord;
      if (p.status === 'REFUNDED') return { kind: 'refunded', payment: p, replayed: true };
      if (p.status !== 'APPROVED') return { kind: 'conflict', status: p.status };
      tx.update(ref, { status: 'REFUNDED', refundId });
      return { kind: 'refunded', payment: { ...p, status: 'REFUNDED', refundId }, replayed: false };
    });
  }
}
