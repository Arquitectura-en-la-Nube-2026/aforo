import { Body, Controller, Get, Headers, HttpCode, Param, Post, Put, Query, UseInterceptors } from "@nestjs/common";
import { CurrentUser, IdempotencyInterceptor, type AuthenticatedUser } from "@aforo/common/nest";
import type { Event } from "./event.view";
import { EventsService, type EventPage } from "./events.service";
import { parseCreateEvent, parseListQuery, parseSalesRules, uuidParam } from "./validation";

/**
 * Reached only through the Gateway (Cloud Run IAM). Reads are public; changes need the organizer's
 * X-User-Id. There are no roles: any signed-in user can act as organizer (D-06, D-08).
 */
@Controller("api/v1/events")
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  list(@Query() query: Record<string, unknown>): Promise<EventPage> {
    return this.events.list(parseListQuery(query));
  }

  @Get(":eventId")
  get(@Param("eventId") eventId: string): Promise<Event> {
    return this.events.get(uuidParam("eventId", eventId));
  }

  @Post()
  @UseInterceptors(IdempotencyInterceptor)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body() body: unknown,
  ): Promise<Event> {
    // The interceptor has already rejected a missing or non-UUID key.
    return this.events.create(parseCreateEvent(body), user.userId, idempotencyKey.trim());
  }

  @Put(":eventId/sales-rules")
  @UseInterceptors(IdempotencyInterceptor)
  configureRules(
    @CurrentUser() _user: AuthenticatedUser,
    @Param("eventId") eventId: string,
    @Body() body: unknown,
  ): Promise<Event> {
    return this.events.configureRules(uuidParam("eventId", eventId), parseSalesRules(body));
  }

  @Post(":eventId/publish")
  @HttpCode(200)
  @UseInterceptors(IdempotencyInterceptor)
  publish(@CurrentUser() _user: AuthenticatedUser, @Param("eventId") eventId: string): Promise<Event> {
    return this.events.publish(uuidParam("eventId", eventId));
  }
}
