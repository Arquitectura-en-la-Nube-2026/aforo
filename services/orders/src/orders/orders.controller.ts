import { Body, Controller, Get, Headers, Param, Post, Query, UseInterceptors } from '@nestjs/common';
import { CurrentUser, IdempotencyInterceptor } from '../common';
import { CreateOrderDto } from './orders.dto';
import { OrdersService } from './orders.service';
import { IdempotencyKey, parsePage, uuidParam } from './request-params';

@Controller('api/v1/orders')
export class OrdersController {
  constructor(private readonly service: OrdersService) {}

  @Post()
  @UseInterceptors(IdempotencyInterceptor)
  create(
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateOrderDto,
    @IdempotencyKey() key: string,
    @Headers('x-queue-pass') queuePass?: string,
  ) {
    return this.service.createOrder(user.userId, dto, key, queuePass);
  }

  @Get()
  list(@CurrentUser() user: { userId: string }, @Query('page') page?: string, @Query('size') size?: string) {
    const p = parsePage(page, size);
    return this.service.listOrders(user.userId, p.page, p.size);
  }

  @Get(':orderId')
  get(@CurrentUser() user: { userId: string }, @Param('orderId', uuidParam()) orderId: string) {
    return this.service.getOrder(user.userId, orderId);
  }

  @Post(':orderId/payment-intents')
  @UseInterceptors(IdempotencyInterceptor)
  createPaymentIntent(
    @CurrentUser() user: { userId: string },
    @Param('orderId', uuidParam()) orderId: string,
    @IdempotencyKey() key: string,
    @Headers('x-queue-pass') queuePass?: string,
  ) {
    return this.service.createPaymentIntent(user.userId, orderId, key, queuePass);
  }
}
