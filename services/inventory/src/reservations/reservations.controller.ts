import { Body, Controller, HttpCode, Param, Post, UseInterceptors } from "@nestjs/common";
import { IdempotencyInterceptor } from "@aforo/common/nest";
import { ReservationsService, type Reservation, type ReservationTransition } from "./reservations.service";
import { parseCreateReservation, uuidParam } from "./validation";

/**
 * Internal API: only Orders and Cloud Tasks reach it (Cloud Run IAM). No pass check (D-07); the
 * buyer is the one Orders sends.
 */
@Controller("internal/v1/reservations")
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Post()
  @UseInterceptors(IdempotencyInterceptor)
  create(@Body() body: unknown): Promise<Reservation> {
    return this.reservations.reserve(parseCreateReservation(body));
  }

  @Post(":reservationId/confirm")
  @HttpCode(200)
  @UseInterceptors(IdempotencyInterceptor)
  confirm(@Param("reservationId") id: string): Promise<ReservationTransition> {
    return this.reservations.confirm(uuidParam("reservationId", id));
  }

  @Post(":reservationId/release")
  @HttpCode(200)
  @UseInterceptors(IdempotencyInterceptor)
  release(@Param("reservationId") id: string): Promise<ReservationTransition> {
    return this.reservations.release(uuidParam("reservationId", id));
  }

  /** Cloud Tasks target; no Idempotency-Key (the transition itself is idempotent). */
  @Post(":reservationId/expire")
  @HttpCode(200)
  expire(@Param("reservationId") id: string): Promise<ReservationTransition> {
    return this.reservations.expire(uuidParam("reservationId", id));
  }
}
