import { IsIn, IsISO8601, IsUUID } from 'class-validator';

export class PaymentNotificationDto {
  @IsUUID('4')
  notificationId!: string;

  @IsUUID('4')
  paymentId!: string;

  @IsUUID('4')
  orderId!: string;

  @IsIn(['APPROVED', 'DECLINED'])
  status!: 'APPROVED' | 'DECLINED';

  @IsISO8601()
  occurredAt!: string;
}
