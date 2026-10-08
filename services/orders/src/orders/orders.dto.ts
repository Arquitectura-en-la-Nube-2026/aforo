import { IsInt, IsUUID, Min } from 'class-validator';

export class CreateOrderDto {
  @IsUUID('4')
  eventId!: string;

  @IsUUID('4')
  sectorId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;
}
