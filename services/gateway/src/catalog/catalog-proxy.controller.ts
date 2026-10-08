import { Controller, Get, Param, Post, Put, Req, Res } from "@nestjs/common";
import { Public } from "@aforo/common/nest";
import type { FastifyReply, FastifyRequest } from "fastify";
import { CatalogProxyService } from "./catalog-proxy.service";

/** Only the Catalog routes in the public route map; /availability belongs to Inventory. */
@Controller("api/v1/events")
export class CatalogProxyController {
  constructor(private readonly proxy: CatalogProxyService) {}

  @Public()
  @Get()
  list(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    return this.proxy.forward("list", null, request, reply);
  }

  @Public()
  @Get(":eventId")
  detail(@Param("eventId") eventId: string, @Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    return this.proxy.forward("detail", eventId, request, reply);
  }

  @Post()
  create(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    return this.proxy.forward("create", null, request, reply);
  }

  @Put(":eventId/sales-rules")
  configureRules(@Param("eventId") eventId: string, @Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    return this.proxy.forward("configureRules", eventId, request, reply);
  }

  @Post(":eventId/publish")
  publish(@Param("eventId") eventId: string, @Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    return this.proxy.forward("publish", eventId, request, reply);
  }
}
